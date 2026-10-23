"""BTC market adapter over the unchanged, previously audited Spot ledger.

Own local ledger/planner code is loaded in private module namespaces. Only the
market quantity step and receipt asset labels change; the imported SOL modules
and their globals are never patched. No downloaded strategy code is executed.
Capital stays 15/12/3; this separately registered BTC variant permits reserved
risk min(3 USDT, NAV/5). This research choice predates financial outcomes and
does not alter the frozen SOL variant's 1.50/NAV10 policy.
"""
from __future__ import annotations

from decimal import Decimal
import hashlib
import importlib.util
from pathlib import Path

from spot_backtest.account import exact, floor_step, ceil_step

D = Decimal
STEP = D("0.00001")
TICK = D("0.01")
FEE_QUANTUM = D("0.00000001")
BACKEND = Path(__file__).resolve().parents[1]
LEDGER_PATH = BACKEND / "spot_backtest/account.py"
PLANNER_PATH = BACKEND / "spot_aggressive_v3/account.py"
LEDGER_SHA = "2570facd7bac1d2cf57889878a245eddc31ecf85995ee569b91b9325eb8985ee"
PLANNER_SHA = "e23c0b70ad518cb8e0c5fb78f0d1f892e904ba8e9691ae37624d9414638df507"


def _private_module(path: Path, expected_sha: str, name: str):
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha:
        raise ValueError("registered local accounting dependency changed")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.STEP = STEP
    module.TICK = TICK
    module.FEE_QUANTUM = FEE_QUANTUM
    return module


_ledger = _private_module(LEDGER_PATH, LEDGER_SHA, "spot_btc_private_ledger")
_planner = _private_module(PLANNER_PATH, PLANNER_SHA, "spot_btc_private_planner")
_planner.MAX_RISK = D("3")
_planner.NAV_RISK_DIVISOR = D("5")


class BTCAccount(_ledger.SpotAccount):
    """Same ledger/planning arithmetic, BTC units and distinct research caps.

    The base ledger is inherited from its private namespace; two planner
    methods are bound unchanged to this class and use its private BTC constants.
    Fee-related legacy SOL field names are exposed as base/BTC aliases too.
    """
    buy = _planner.ResearchAccount.buy

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.initial_cash != D("15"):
            raise ValueError("BTC research starts at exactly 15 USDT")
        self._entry_plans = {}

    def plan_entry(self, *args, **kwargs):
        plan = _planner.ResearchAccount.plan_entry(self, *args, **kwargs)
        if plan.get("eligible") is True:
            plan["base_asset"] = "BTC"
            plan["entry_fee_btc"] = plan["entry_fee_sol"]
            plan["net_bought_btc"] = plan["net_bought_sol"]
        return plan

    def book_nav(self, reference):
        return self.nav(reference, executable=False)

    def apply_fill(self, fill):
        event = super().apply_fill(fill)
        if event.get("eligible") is True:
            event["fee_asset"] = "BTC" if event["side"] == "BUY" else "USDT"
            event["base_asset"] = "BTC"
            if "entry_fee_sol" in event:
                event["entry_fee_btc"] = event["entry_fee_sol"]
            if "net_bought_sol" in event:
                event["net_bought_btc"] = event["net_bought_sol"]
            self._fills[event["fill_id"]].update(event)
            # A duplicate is a historical receipt, never a new last event.
            if not event.get("duplicate"):
                self.events[-1].update(event)
        return event

