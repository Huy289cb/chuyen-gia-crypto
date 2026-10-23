"""Cost-aware SOL entry planning over the unchanged exact Spot fill ledger.

The hurdle is a diagnostic price for a strategy without a fixed target. It is
never converted into an exit target. Old inventory cannot subsidise the
new-order-alone economic or minimum-notional checks.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, localcontext
from typing import Any, Mapping

from spot_backtest.account import (
    SpotAccount, D, ZERO, MAX_COST, MIN_CASH, MAX_RISK, STEP, TICK,
    FEE_QUANTUM, exact, floor_step, ceil_step,
)


class ResearchAccount(SpotAccount):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._entry_plans: dict[str, dict[str, Any]] = {}

    def plan_entry(self, ref_price: Decimal, stop: Decimal,
                   target: Decimal | None, risk_limit: Decimal,
                   daily_headroom: Decimal, hurdle_price: Decimal) -> dict[str, Any]:
        """Largest feasible quantity satisfying both portfolio and solo risk.

        All economics use full-fill assumption; actual partial inventory is
        logged at fill time and may be stranded. A fixed target must also be
        the hurdle so a distant diagnostic price cannot qualify a closer TP.
        """
        blocked = {"eligible": False, "reasons": [], "quantity": ZERO}
        try:
            with localcontext() as context:
                context.prec = 50
                reference, stop, requested_risk, headroom, hurdle = map(
                    exact, (ref_price, stop, risk_limit, daily_headroom, hurdle_price))
                stop, hurdle = floor_step(stop, TICK), floor_step(hurdle, TICK)
                fixed_target = None if target is None else floor_step(exact(target), TICK)
                buy_price = self._price(reference, buy=True)
                if not ZERO < stop < buy_price < hurdle:
                    return {**blocked, "reasons": ["invalid_entry_stop_hurdle"]}
                if fixed_target is not None:
                    if not stop < buy_price < fixed_target:
                        return {**blocked, "reasons": ["invalid_entry_stop_target"]}
                    if fixed_target != hurdle:
                        return {**blocked, "reasons": ["target_hurdle_mismatch"]}
                before_nav = self.nav(reference)
                effective_risk = min(requested_risk, headroom, MAX_RISK, before_nav / D("30"))
                available = min(MAX_COST, self.cash - MIN_CASH)
                if available <= ZERO or effective_risk <= ZERO:
                    return {**blocked, "reasons": ["cash_or_daily_risk_headroom"]}
                max_lots = int(floor_step(available / buy_price, STEP) / STEP)
                min_lots = max(1, int(ceil_step(self.min_notional / buy_price, STEP) / STEP))
                reasons: set[str] = set()
                for lots in range(max_lots, min_lots - 1, -1):
                    quantity = STEP * lots
                    cost = quantity * buy_price
                    base_fee = ceil_step(quantity * self.buy_fee, FEE_QUANTUM)
                    new_inventory = quantity - base_fee
                    solo_stop = self._liquidation(new_inventory, stop)
                    solo_hurdle = self._liquidation(new_inventory, hurdle)
                    solo_flat = self._liquidation(new_inventory, reference)
                    if not solo_stop["eligible"]:
                        reasons.add("solo_stop_exit_below_minimum_after_base_fee")
                        continue
                    if not solo_hurdle["eligible"]:
                        reasons.add("solo_hurdle_exit_below_minimum_after_base_fee")
                        continue
                    if not solo_flat["eligible"]:
                        reasons.add("solo_flat_exit_below_minimum_after_base_fee")
                        continue
                    combined_inventory = self.inventory + new_inventory
                    portfolio_stop = self._liquidation(combined_inventory, stop)
                    portfolio_hurdle = self._liquidation(combined_inventory, hurdle)
                    stop_nav = self.cash - cost + portfolio_stop["net"]
                    hurdle_nav = self.cash - cost + portfolio_hurdle["net"]
                    stop_loss = max(ZERO, before_nav - stop_nav)
                    solo_loss = cost - solo_stop["net"]
                    planned_risk = max(stop_loss, solo_loss)
                    if planned_risk > effective_risk:
                        reasons.add("portfolio_or_solo_stop_risk_exceeds_headroom")
                        continue
                    drag = max(ZERO, cost - solo_flat["net"])
                    solo_profit = solo_hurdle["net"] - cost
                    if solo_profit <= ZERO or solo_loss <= ZERO:
                        reasons.add("solo_hurdle_profit_not_positive")
                        continue
                    if solo_profit < D("1.5") * solo_loss:
                        reasons.add("solo_net_reward_risk_below_1_5")
                        continue
                    hurdle_benefit = solo_hurdle["net"] - solo_flat["net"]
                    if hurdle_benefit < D("4") * drag:
                        reasons.add("solo_hurdle_benefit_below_4x_drag")
                        continue
                    return {
                        "eligible": True, "reasons": [], "quantity": quantity,
                        "ref_price": reference, "stop": stop, "target": fixed_target,
                        "hurdle_price": hurdle, "hurdle_is_exit_target": fixed_target is not None,
                        "buy_price": buy_price, "reserved_cost": cost,
                        "entry_fee_sol": base_fee, "net_bought_sol": new_inventory,
                        "sellableqty": portfolio_stop["quantity"],
                        "sellable_quantity": portfolio_stop["quantity"],
                        "stop_price": portfolio_stop["price"],
                        "target_price": portfolio_hurdle["price"] if fixed_target is not None else None,
                        "stop_loss": stop_loss, "target_profit": hurdle_nav - before_nav if fixed_target is not None else None,
                        "hurdle_profit": hurdle_nav - before_nav,
                        "solo_stop_loss": solo_loss, "solo_hurdle_profit": solo_profit,
                        "solo_stop_net": solo_stop["net"], "solo_hurdle_net": solo_hurdle["net"],
                        "solo_flat_net": solo_flat["net"], "roundtrip_drag": drag,
                        "hurdle_benefit_over_flat": hurdle_benefit,
                        "net_reward_risk": solo_profit / solo_loss,
                        "effective_planned_risk": planned_risk,
                        "before_nav": before_nav, "stop_nav": stop_nav,
                        "target_nav": hurdle_nav if fixed_target is not None else None,
                        "hurdle_nav": hurdle_nav,
                        "risk_limit": requested_risk, "daily_headroom": headroom,
                        "effective_risk_limit": effective_risk,
                        "account_cash": self.cash, "account_inventory": self.inventory,
                        "cash_after_full_fill": self.cash - cost,
                        "full_fill_assumed": True,
                    }
                if max_lots < min_lots:
                    reasons.add("entry_below_minimum_under_cash_cap")
                return {**blocked, "reasons": sorted(reasons) or ["no_valid_quantity"]}
        except (ValueError, InvalidOperation, ArithmeticError, TypeError):
            return {**blocked, "reasons": ["unknown_or_invalid_decimal_input"]}

    def buy(self, plan: Mapping[str, Any], timestamp_us: int, setup_id: str) -> dict[str, Any]:
        """Revalidate a research plan, then use the unchanged idempotent ledger."""
        fill_id = f"BUY:{setup_id}:{timestamp_us}"
        try:
            if fill_id in self._fills:
                saved_plan = self._entry_plans.get(fill_id)
                if saved_plan is None or any(plan.get(k) != value for k, value in saved_plan.items()):
                    return self._rejected("modified_duplicate_plan")
                quantity = floor_step(exact(plan["quantity"]) * self.partial_fraction, STEP)
                return self.apply_fill({"fill_id": fill_id, "side": "BUY", "timestamp_us": timestamp_us,
                                        "quantity": quantity, "price": plan["buy_price"],
                                        "order_quantity": plan["quantity"], "setup_id": setup_id,
                                        "reason": "ENTRY"})
            if plan.get("eligible") is not True:
                return self._rejected("ineligible_plan")
            if plan.get("account_cash") != self.cash or plan.get("account_inventory") != self.inventory:
                return self._rejected("stale_account_plan")
            current = self.plan_entry(plan["ref_price"], plan["stop"], plan["target"],
                                      plan["risk_limit"], plan["daily_headroom"], plan["hurdle_price"])
            if current.get("eligible") is not True or any(plan.get(k) != value for k, value in current.items()):
                return self._rejected("modified_or_invalid_plan")
            quantity = floor_step(plan["quantity"] * self.partial_fraction, STEP)
            if quantity < STEP:
                return self._rejected("partial_fill_zero_lots", status="CANCELLED")
            event = self.apply_fill({"fill_id": fill_id, "side": "BUY", "timestamp_us": timestamp_us,
                                     "quantity": quantity, "price": plan["buy_price"],
                                     "order_quantity": plan["quantity"], "setup_id": setup_id,
                                     "reason": "ENTRY"})
            if event["eligible"]:
                stop_liquidation = self._liquidation(self.inventory, plan["stop"])
                event.update({
                    "planned_full_fill_stop_loss": plan["stop_loss"],
                    "planned_new_order_alone_stop_loss": plan["solo_stop_loss"],
                    "effective_planned_risk": plan["effective_planned_risk"],
                    "actual_fill_stop_loss": max(ZERO, plan["before_nav"] - self.nav(plan["stop"])),
                    "partial_stranded_at_stop": not stop_liquidation["eligible"],
                    "requested_quantity": plan["quantity"],
                    "entry_target": plan["target"],
                    "diagnostic_hurdle_price": plan["hurdle_price"],
                    "net_reward_risk_at_plan": plan["net_reward_risk"],
                })
                self._fills[fill_id].update(event)
                self.events[-1].update(event)
                self._entry_plans[fill_id] = dict(current)
            return event
        except (KeyError, ValueError, TypeError, AttributeError, InvalidOperation, ArithmeticError):
            return self._rejected("unknown_or_invalid_plan")
