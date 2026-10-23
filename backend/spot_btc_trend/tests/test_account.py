from decimal import Decimal as D
import unittest

from spot_backtest.account import SpotAccount, STEP as SOL_STEP
from spot_aggressive_v3.account import ResearchAccount
from spot_btc_trend.account import BTCAccount, STEP


class BTCAdapterTests(unittest.TestCase):
    def test_btc_lots_fees_and_idempotent_cash(self):
        account = BTCAccount()
        plan = account.plan_entry(D("60000"), D("51000"), None, D("3"), D("3"), D("90000"))
        self.assertTrue(plan["eligible"])
        self.assertEqual(plan["quantity"] % STEP, 0)
        self.assertLessEqual(plan["reserved_cost"], D("12"))
        self.assertLessEqual(plan["effective_planned_risk"], D("3"))
        self.assertEqual(plan["entry_fee_sol"], D("0.00000019"))
        event = account.buy(plan, 1, "entry-one")
        self.assertTrue(event["eligible"])
        self.assertEqual(event["fee_asset"], "BTC")
        before = (account.cash, account.inventory, len(account.events))
        repeat = account.buy(plan, 1, "entry-one")
        self.assertTrue(repeat["duplicate"])
        self.assertEqual(before, (account.cash, account.inventory, len(account.events)))
        exit_event = account.sell(D("66000"), 2, "EXIT")
        self.assertTrue(exit_event["eligible"])
        self.assertEqual(exit_event["fee_asset"], "USDT")
        self.assertEqual(exit_event["filled_quantity"] % STEP, 0)
        self.assertGreaterEqual(account.cash, D("3"))
        self.assertLess(account.inventory, STEP)
        cash = account.cash
        self.assertTrue(account.sell(D("66000"), 2, "EXIT")["duplicate"])
        self.assertEqual(account.cash, cash)

    def test_original_sol_market_and_planner_are_unchanged(self):
        import spot_backtest.account as ledger
        import spot_aggressive_v3.account as planner
        self.assertEqual(SOL_STEP, D(".001"))
        self.assertEqual(ledger.STEP, D(".001"))
        self.assertEqual(planner.STEP, D(".001"))
        self.assertEqual(planner.MAX_RISK, D("1.50"))
        self.assertEqual(planner.NAV_RISK_DIVISOR, D("10"))
        original = ResearchAccount()
        plan = original.plan_entry(D("100"), D("95"), None, D("1.5"), D("1.5"), D("120"))
        self.assertTrue(plan["eligible"])
        self.assertEqual(plan["quantity"] % D(".001"), 0)
        self.assertTrue(original.buy(plan, 1, "sol")["eligible"])
        self.assertEqual(original.events[0]["fee_asset"], "SOL")
        self.assertEqual(SpotAccount().inventory, 0)

    def test_reject_capital_and_conflicting_duplicate(self):
        with self.assertRaises(ValueError):
            BTCAccount(initial_cash=D("30"))
        with self.assertRaises(ValueError):
            BTCAccount(initial_cash=D("10"))
        account = BTCAccount()
        plan = account.plan_entry(D("60000"), D("51000"), None, D("3"), D("3"), D("90000"))
        account.buy(plan, 1, "first")
        changed = dict(plan, quantity=plan["quantity"] + STEP)
        before = (account.cash, account.inventory)
        self.assertFalse(account.buy(changed, 1, "first")["eligible"])
        self.assertEqual(before, (account.cash, account.inventory))

    def test_tiny_btc_entry_risk_and_dust_are_not_ignored(self):
        account = BTCAccount()
        low_risk = account.plan_entry(D("60000"), D("51000"), None, D("1.5"), D("1.5"), D("90000"))
        self.assertFalse(low_risk["eligible"])
        admitted = account.plan_entry(D("60000"), D("51000"), None, D("3"), D("3"), D("90000"))
        self.assertTrue(admitted["eligible"])
        self.assertLess(admitted["sellable_quantity"], admitted["quantity"])
        self.assertGreater(admitted["roundtrip_drag"], admitted["reserved_cost"] * D(".002"))


if __name__ == "__main__":
    unittest.main()
