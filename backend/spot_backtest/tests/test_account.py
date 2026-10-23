"""Accounting invariants and adversarial tiny-capital scenarios, no market data."""

import unittest
from decimal import Decimal as D

from spot_backtest.account import SpotAccount


class AccountTests(unittest.TestCase):
    @staticmethod
    def plan(account, **changes):
        values = dict(ref_price=D("109.72"), stop=D("108"), target=D("113"),
                      risk_limit=D(".5"), daily_headroom=D("1.5"))
        values.update(changes)
        return account.plan_buy(**values)

    def test_full_cash_purchase_15_not_30_and_exact_stop_risk(self):
        account = SpotAccount()
        plan = self.plan(account)
        self.assertTrue(plan["eligible"])
        self.assertEqual(account.cash, D("15"))
        self.assertEqual(plan["quantity"], D(".109"))
        self.assertEqual(plan["reserved_cost"], D("11.97147"))
        fill = account.buy(plan, 1, "setup-a")
        self.assertTrue(fill["eligible"])
        self.assertEqual(account.cash, D("3.02853"))
        self.assertEqual(account.inventory, D(".108891"))
        self.assertEqual(plan["stop_loss"], D("15") - account.nav(D("108")))
        self.assertEqual(plan["stop_loss"], D(".33100212"))
        with self.assertRaises(ValueError):
            SpotAccount(initial_cash=D("30"))

    def test_buy_and_stop_minimum_after_base_commission(self):
        # A valid entry at 5.27 USDT strands every possible exit after a wide stop.
        account = SpotAccount(initial_cash=D("8.28"))
        plan = self.plan(account, stop=D("100"))
        self.assertFalse(plan["eligible"])
        self.assertIn("stop_exit_below_minimum_after_base_fee", plan["reasons"])
        self.assertEqual(account.events, [])
        self.assertEqual(account.cash, D("8.28"))

    def test_smaller_risk_never_rounds_up_and_zero_target_profit_is_blocked(self):
        account = SpotAccount()
        large = self.plan(account)
        small = self.plan(account, daily_headroom=D(".25"))
        self.assertTrue(small["eligible"])
        self.assertLess(small["quantity"], large["quantity"])
        self.assertLessEqual(small["stop_loss"], D(".25"))
        blocked = self.plan(account, target=D("110"))
        self.assertFalse(blocked["eligible"])
        self.assertIn("target_net_profit_not_positive", blocked["reasons"])

    def test_partial_entry_can_strand_inventory_remainder_cancelled(self):
        account = SpotAccount(initial_cash=D("9"), partial_fraction=D(".5"))
        plan = self.plan(account)
        self.assertTrue(plan["eligible"])
        before = account.cash
        fill = account.buy(plan, 2, "partial")
        self.assertTrue(fill["eligible"])
        self.assertEqual(fill["status"], "PARTIALLY_FILLED_CANCELLED")
        self.assertGreater(fill["cancelled_quantity"], D("0"))
        self.assertEqual(before - account.cash, fill["gross_quote"])
        self.assertGreater(fill["actual_fill_stop_loss"], fill["planned_full_fill_stop_loss"])
        self.assertTrue(fill["partial_stranded_at_stop"])
        inventory = account.inventory
        failed_exit = account.sell(D("108"), 3, "STOP")
        self.assertFalse(failed_exit["eligible"])
        self.assertEqual(failed_exit["status"], "NO_EXIT")
        self.assertEqual(account.inventory, inventory)
        self.assertEqual(account.nav(D("108")), account.cash)
        self.assertGreater(account.book_nav(D("108")), account.nav(D("108")))

    def test_dust_carries_into_next_trade_and_changes_sellable_quantity(self):
        account = SpotAccount()
        first_plan = self.plan(account)
        account.buy(first_plan, 10, "first")
        exit_fill = account.sell(D("120"), 11, "TARGET")
        self.assertTrue(exit_fill["eligible"])
        self.assertEqual(account.inventory, D(".000891"))
        cash = account.cash
        second_plan = self.plan(account)
        self.assertTrue(second_plan["eligible"])
        self.assertEqual(second_plan["sellableqty"], second_plan["quantity"])
        self.assertEqual(second_plan["before_nav"], cash)
        second_fill = account.buy(second_plan, 12, "second")
        self.assertTrue(second_fill["eligible"])
        self.assertEqual(second_plan["stop_loss"], cash - account.nav(D("108")))
        self.assertGreater(account.inventory, second_fill["inventory_delta"])

    def test_duplicate_buy_sell_and_external_fill_are_idempotent(self):
        account = SpotAccount()
        plan = self.plan(account)
        fill = account.buy(plan, 20, "same")
        state = account.cash, account.inventory, len(account.events)
        duplicate = account.buy(plan, 20, "same")
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(state, (account.cash, account.inventory, len(account.events)))
        duplicate = account.apply_fill(fill)
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(state, (account.cash, account.inventory, len(account.events)))
        conflicting = account.apply_fill({**fill, "price": D("109.84")})
        self.assertFalse(conflicting["eligible"])
        self.assertEqual(state, (account.cash, account.inventory, len(account.events)))
        account.sell(D("113"), 21, "TARGET")
        state = account.cash, account.inventory, len(account.events)
        duplicate = account.sell(D("113"), 21, "TARGET")
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(state, (account.cash, account.inventory, len(account.events)))

    def test_oversell_negative_cash_stale_plan_and_ledger_reconciliation(self):
        account = SpotAccount()
        rejected = account.apply_fill({"fill_id": "bad", "side": "BUY", "timestamp_us": 1,
                                       "quantity": D(".2"), "price": D("109.83")})
        self.assertFalse(rejected["eligible"])
        plan = self.plan(account)
        account.buy(plan, 30, "one")
        stale = account.buy(plan, 31, "two")
        self.assertFalse(stale["eligible"])
        rejected = account.apply_fill({"fill_id": "oversell", "side": "SELL", "timestamp_us": 32,
                                       "quantity": D(".109"), "price": D("120")})
        self.assertFalse(rejected["eligible"])
        self.assertEqual(rejected["reasons"], ["oversell"])
        account.sell(D("108"), 33, "STOP")
        self.assertEqual(account.cash, D("15") + sum(event["cash_delta"] for event in account.events))
        self.assertEqual(account.inventory, sum(event["inventory_delta"] for event in account.events))
        self.assertGreaterEqual(account.cash, D("0"))
        self.assertGreaterEqual(account.inventory, D("0"))
        low_cash = SpotAccount(initial_cash=D("3"))
        rejected = low_cash.apply_fill({"fill_id": "no-cash", "side": "BUY", "timestamp_us": 34,
                                        "quantity": D(".05"), "price": D("100")})
        self.assertFalse(rejected["eligible"])
        self.assertEqual(low_cash.cash, D("3"))
        self.assertEqual(low_cash.inventory, D("0"))

    def test_ten_usdt_minimum_and_invalid_unknown_input(self):
        account = SpotAccount(min_notional=D("10"))
        plan = self.plan(account)
        self.assertTrue(plan["eligible"])
        self.assertGreaterEqual(plan["sellableqty"] * plan["stop_price"], D("10"))
        blocked = self.plan(account, ref_price=109.72)
        self.assertFalse(blocked["eligible"])
        blocked = self.plan(account, daily_headroom=D("0"))
        self.assertFalse(blocked["eligible"])


if __name__ == "__main__":
    unittest.main()
