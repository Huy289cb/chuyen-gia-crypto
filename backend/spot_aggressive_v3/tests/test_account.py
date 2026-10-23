"""Adversarial cost and ownership checks without historical market data."""
import unittest
from decimal import Decimal as D

from spot_aggressive_v3.account import ResearchAccount
from spot_backtest.account import SpotAccount, STEP, floor_step


class ResearchAccountTests(unittest.TestCase):
    @staticmethod
    def plan(account, **changes):
        values = dict(ref_price=D("100"), stop=D("98"), target=D("110"),
                      risk_limit=D(".5"), daily_headroom=D("1.5"), hurdle_price=D("110"))
        values.update(changes)
        return account.plan_entry(**values)

    def test_full_fill_retains_15_12_3_caps_and_exact_asset_commission(self):
        account = ResearchAccount()
        plan = self.plan(account)
        self.assertTrue(plan["eligible"])
        self.assertEqual(plan["quantity"], D(".119"))
        self.assertEqual(plan["reserved_cost"], D("11.9119"))
        self.assertEqual(plan["entry_fee_sol"], D(".00011900"))
        self.assertEqual(plan["solo_flat_net"], D("11.77641180"))
        self.assertEqual(plan["roundtrip_drag"], D(".13548820"))
        self.assertGreaterEqual(plan["net_reward_risk"], D("1.5"))
        self.assertGreaterEqual(plan["hurdle_benefit_over_flat"], D("4") * plan["roundtrip_drag"])
        receipt = account.buy(plan, 1, "fixed")
        self.assertTrue(receipt["eligible"])
        self.assertEqual(account.cash, D("3.0881"))
        self.assertEqual(account.inventory, D(".11888100"))
        self.assertEqual(receipt["fee_asset"], "SOL")
        self.assertEqual(receipt["planned_full_fill_stop_loss"], D("15") - account.nav(D("98")))
        self.assertGreaterEqual(account.cash, D("3"))
        self.assertIsInstance(account, SpotAccount)
        with self.assertRaises(ValueError):
            ResearchAccount(initial_cash=D("30"))

    def test_targetless_trend_can_buy_without_fake_tp(self):
        account = ResearchAccount()
        plan = self.plan(account, target=None)
        self.assertTrue(plan["eligible"])
        self.assertIsNone(plan["target"])
        self.assertIsNone(plan["target_price"])
        self.assertIsNone(plan["target_profit"])
        self.assertIsNone(plan["target_nav"])
        self.assertFalse(plan["hurdle_is_exit_target"])
        receipt = account.buy(plan, 2, "trend")
        self.assertTrue(receipt["eligible"])
        self.assertIsNone(receipt["entry_target"])
        self.assertEqual(receipt["diagnostic_hurdle_price"], D("110"))

    def test_positive_target_profit_alone_is_insufficient(self):
        account = ResearchAccount()
        original = account.plan_buy(D("100"), D("98"), D("104"), D(".5"), D("1.5"))
        self.assertTrue(original["eligible"])
        self.assertGreater(original["target_profit"], D("0"))
        strict = self.plan(account, target=D("104"), hurdle_price=D("104"))
        self.assertFalse(strict["eligible"])
        self.assertIn("solo_hurdle_benefit_below_4x_drag", strict["reasons"])
        self.assertEqual(account.events, [])

    def test_cost_hurdle_blocks_narrow_even_when_rr_can_pass(self):
        account = ResearchAccount()
        narrow = self.plan(account, stop=D("99.99"), target=D("103"), hurdle_price=D("103"))
        self.assertFalse(narrow["eligible"])
        self.assertIn("solo_hurdle_benefit_below_4x_drag", narrow["reasons"])

    def test_old_dust_cannot_inflate_new_order_reward_or_rescue_cost_failure(self):
        fresh, dusty = ResearchAccount(), ResearchAccount()
        dusty.inventory = D(".000999")  # owned but below the registered sale step
        before = dusty.inventory
        first, second = self.plan(fresh), self.plan(dusty)
        self.assertTrue(first["eligible"])
        self.assertTrue(second["eligible"])
        for field in ("quantity", "solo_stop_loss", "solo_hurdle_profit", "solo_flat_net",
                      "roundtrip_drag", "net_reward_risk"):
            self.assertEqual(first[field], second[field])
        self.assertGreater(second["hurdle_profit"], first["hurdle_profit"])
        self.assertEqual(dusty.inventory, before)
        weak = dict(stop=D("99.99"), target=D("103"), hurdle_price=D("103"))
        self.assertFalse(self.plan(fresh, **weak)["eligible"])
        self.assertFalse(self.plan(dusty, **weak)["eligible"])

    def test_both_solo_and_portfolio_risk_fit_actual_headroom(self):
        account = ResearchAccount()
        account.inventory = D(".000999")
        normal = self.plan(account)
        tight = self.plan(account, daily_headroom=D(".25"))
        self.assertTrue(tight["eligible"])
        self.assertLess(tight["quantity"], normal["quantity"])
        self.assertLessEqual(tight["stop_loss"], D(".25"))
        self.assertLessEqual(tight["solo_stop_loss"], D(".25"))
        self.assertEqual(tight["effective_planned_risk"], max(tight["stop_loss"], tight["solo_stop_loss"]))
        # Decreasing one lot is permitted; increasing size to minimum is not.
        blocked = self.plan(account, daily_headroom=D(".01"))
        self.assertFalse(blocked["eligible"])
        self.assertIn("portfolio_or_solo_stop_risk_exceeds_headroom", blocked["reasons"])

    def test_solo_minimum_not_rescued_by_owned_inventory(self):
        account = ResearchAccount(initial_cash=D("8.4"))
        account.inventory = D(".04")
        plan = self.plan(account, stop=D("95"), hurdle_price=D("120"), target=D("120"))
        self.assertFalse(plan["eligible"])
        self.assertIn("solo_stop_exit_below_minimum_after_base_fee", plan["reasons"])
        self.assertEqual(account.cash, D("8.4"))
        self.assertEqual(account.inventory, D(".04"))

    def test_existing_sellable_inventory_cannot_bypass_portfolio_stop_risk(self):
        account = ResearchAccount()
        self.assertTrue(self.plan(account)["eligible"])
        account.inventory = D(".2")
        blocked = self.plan(account)
        self.assertFalse(blocked["eligible"])
        self.assertIn("portfolio_or_solo_stop_risk_exceeds_headroom", blocked["reasons"])
        self.assertEqual((account.cash, account.inventory), (D("15"), D(".2")))

    def test_partial_fill_logs_cancelled_remainder_and_stranded_owned_inventory(self):
        account = ResearchAccount(initial_cash=D("9"), partial_fraction=D(".5"))
        plan = self.plan(account)
        self.assertTrue(plan["eligible"])
        receipt = account.buy(plan, 3, "partial")
        self.assertTrue(receipt["eligible"])
        self.assertEqual(receipt["status"], "PARTIALLY_FILLED_CANCELLED")
        self.assertGreater(receipt["cancelled_quantity"], D("0"))
        self.assertTrue(receipt["partial_stranded_at_stop"])
        self.assertGreater(receipt["actual_fill_stop_loss"], receipt["planned_full_fill_stop_loss"])
        inventory, cash = account.inventory, account.cash
        blocked = account.sell(D("98"), 4, "STOP")
        self.assertFalse(blocked["eligible"])
        self.assertEqual(blocked["status"], "NO_EXIT")
        self.assertEqual((account.cash, account.inventory), (cash, inventory))
        self.assertGreater(account.book_nav(D("98")), account.nav(D("98")))

    def test_tampered_or_stale_plan_cannot_mutate_ledger(self):
        account = ResearchAccount()
        plan = self.plan(account)
        for mutation in ({"quantity": plan["quantity"] + STEP},
                         {"hurdle_price": D("111")},
                         {"solo_stop_loss": D("0")},
                         {"net_reward_risk": D("100")},
                         {"effective_planned_risk": D("0")},
                         {"target": None}):
            self.assertFalse(account.buy({**plan, **mutation}, 5, "tamper")["eligible"])
            self.assertEqual((account.cash, account.inventory, len(account.events)), (D("15"), D("0"), 0))
        fill = account.buy(plan, 6, "valid")
        self.assertTrue(fill["eligible"])
        state = account.cash, account.inventory, len(account.events)
        self.assertFalse(account.buy(plan, 7, "stale")["eligible"])
        self.assertEqual(state, (account.cash, account.inventory, len(account.events)))

    def test_duplicate_buy_and_sell_are_idempotent_and_reconcile_fees(self):
        account = ResearchAccount()
        plan = self.plan(account, target=None)
        first = account.buy(plan, 8, "repeat")
        state = account.cash, account.inventory, len(account.events)
        repeated = account.buy(plan, 8, "repeat")
        self.assertTrue(repeated["duplicate"])
        self.assertEqual(first["entry_target"], repeated["entry_target"])
        self.assertEqual(state, (account.cash, account.inventory, len(account.events)))
        self.assertFalse(account.buy({**plan, "stop": D("97")}, 8, "repeat")["eligible"])
        sale = account.sell(D("110"), 9, "REGIME_EXIT")
        self.assertTrue(sale["eligible"])
        state = account.cash, account.inventory, len(account.events)
        self.assertTrue(account.sell(D("110"), 9, "REGIME_EXIT")["duplicate"])
        self.assertEqual(state, (account.cash, account.inventory, len(account.events)))
        self.assertEqual(account.cash, D("15") + sum(e["cash_delta"] for e in account.events))
        self.assertEqual(account.inventory, sum(e["inventory_delta"] for e in account.events))
        self.assertGreaterEqual(account.cash, D("0"))
        self.assertGreaterEqual(account.inventory, D("0"))

    def test_finite_target_is_same_hurdle_and_entry_geometry_checked_after_delay(self):
        account = ResearchAccount()
        self.assertEqual(self.plan(account, target=D("101"))["reasons"], ["target_hurdle_mismatch"])
        self.assertEqual(self.plan(account, ref_price=D("111"))["reasons"], ["invalid_entry_stop_hurdle"])
        self.assertFalse(self.plan(account, stop=D("101"))["eligible"])

    def test_no_fixed_or_diagnostic_reward_risk_floor_is_fabricated(self):
        for target in (None,D("110")):
            plan=ResearchAccount().plan_entry(D("100"),D("90"),target,D("1.50"),D("1.50"),D("110"))
            self.assertTrue(plan["eligible"])
            self.assertGreater(plan["solo_hurdle_profit"],0)
            self.assertGreater(plan["net_reward_risk"],0)
            self.assertLess(plan["net_reward_risk"],D("1.5"))
            self.assertGreaterEqual(plan["hurdle_benefit_over_flat"],D("4")*plan["roundtrip_drag"])
            self.assertEqual(plan["target"],target)

    def test_aggressive_policy_has_no_hidden_half_dollar_or_nav_thirtieth_cap(self):
        parameters=dict(ref_price=D("100"),stop=D("90"),target=None,
                        risk_limit=D("1.50"),daily_headroom=D("1.50"),hurdle_price=D("125"))
        self.assertFalse(ResearchAccount().plan_entry(**{**parameters,"risk_limit":D(".50")})["eligible"])
        plan=ResearchAccount().plan_entry(**parameters)
        self.assertTrue(plan["eligible"])
        self.assertGreater(plan["effective_planned_risk"],D(".50"))
        self.assertLessEqual(plan["effective_planned_risk"],D("1.50"))
        self.assertEqual(plan["effective_risk_limit"],D("1.50"))
        tight=ResearchAccount(initial_cash=D("10")).plan_entry(**parameters)
        self.assertTrue(tight["eligible"])
        self.assertEqual(tight["effective_risk_limit"],D("1"))
        self.assertLessEqual(tight["effective_planned_risk"],D("1"))

    def test_ten_dollar_minimum_and_exact_decimal_inputs(self):
        account = ResearchAccount(min_notional=D("10"), slip=D(".003"))
        plan = self.plan(account, stop=D("99"), target=D("115"), hurdle_price=D("115"))
        self.assertTrue(plan["eligible"])
        solo_quantity = floor_step(plan["net_bought_sol"], STEP)
        self.assertGreaterEqual(solo_quantity * account._price(plan["stop"]), D("10"))
        self.assertFalse(self.plan(account, ref_price=100.0)["eligible"])
        self.assertFalse(self.plan(account, daily_headroom=D("0"))["eligible"])
        self.assertFalse(self.plan(account, hurdle_price=D("NaN"))["eligible"])
        self.assertFalse(self.plan(account, target=False)["eligible"])


if __name__ == "__main__":
    unittest.main()
