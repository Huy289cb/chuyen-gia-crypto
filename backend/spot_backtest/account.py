"""Offline SOLUSDT cash ledger; fixed 15/12/3 USDT protocol, no broker I/O.

Filter values and fee/slippage inputs are registered scenario assumptions. This
module does not fetch an exchange reference price or decide strategy timing.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_FLOOR, localcontext
from typing import Any, Mapping


D = Decimal
ZERO, ONE = D("0"), D("1")
TICK, STEP, FEE_QUANTUM = D("0.01"), D("0.001"), D("0.00000001")
MAX_CASH, MAX_COST, MIN_CASH, MAX_RISK = D("15"), D("12"), D("3"), D("0.50")


def exact(value: Any) -> Decimal:
    """Reject float rounding, missing values and negative/nonfinite amounts."""
    if isinstance(value, bool) or not isinstance(value, (Decimal, str, int)):
        raise ValueError("exact nonnegative Decimal required")
    try:
        number = D(value)
    except (InvalidOperation, ValueError):
        raise ValueError("invalid Decimal") from None
    if not number.is_finite() or number < ZERO:
        raise ValueError("finite nonnegative Decimal required")
    return number


def floor_step(value: Decimal, step: Decimal) -> Decimal:
    return (value / step).to_integral_value(rounding=ROUND_FLOOR) * step


def ceil_step(value: Decimal, step: Decimal) -> Decimal:
    return (value / step).to_integral_value(rounding=ROUND_CEILING) * step


class SpotAccount:
    def __init__(self, initial_cash: Decimal = D("15"), min_notional: Decimal = D("5"),
                 slip: Decimal = D(".001"), buy_fee: Decimal = D(".001"),
                 sell_fee: Decimal = D(".001"), partial_fraction: Decimal = D("1")):
        self.cash = exact(initial_cash)
        if self.cash > MAX_CASH:
            raise ValueError("Spot protocol cannot include capital above 15 USDT")
        self.initial_cash = self.cash
        self.inventory = ZERO
        self.min_notional = exact(min_notional)
        self.slip, self.buy_fee, self.sell_fee = map(exact, (slip, buy_fee, sell_fee))
        self.partial_fraction = exact(partial_fraction)
        if self.min_notional <= ZERO or any(rate >= ONE for rate in (self.slip, self.buy_fee, self.sell_fee)):
            raise ValueError("positive minimum and rates below one required")
        if not ZERO < self.partial_fraction <= ONE:
            raise ValueError("partial_fraction must be in (0, 1]")
        self.events: list[dict[str, Any]] = []
        self._fills: dict[str, dict[str, Any]] = {}

    def _price(self, ref_price: Decimal, *, buy: bool = False) -> Decimal:
        reference = exact(ref_price)
        if reference <= ZERO:
            raise ValueError("positive reference price required")
        with localcontext() as context:
            context.prec = 50
            reserved = reference * (ONE + self.slip if buy else ONE - self.slip)
            return ceil_step(reserved, TICK) if buy else floor_step(reserved, TICK)

    def _liquidation(self, inventory: Decimal, ref_price: Decimal) -> dict[str, Any]:
        price = self._price(ref_price)
        quantity = floor_step(inventory, STEP)
        gross = quantity * price
        commission = ceil_step(gross * self.sell_fee, FEE_QUANTUM)
        eligible = quantity >= STEP and price > ZERO and gross >= self.min_notional and gross >= commission
        return {"eligible": eligible, "quantity": quantity, "price": price,
                "gross": gross, "fee": commission,
                "net": gross - commission if eligible else ZERO}

    def nav(self, ref_price: Decimal, executable: bool = True) -> Decimal:
        """Executable NAV values unsellable inventory at zero; book NAV separate."""
        reference = exact(ref_price)
        if reference <= ZERO:
            raise ValueError("positive reference price required")
        with localcontext() as context:
            context.prec = 50
            if not executable:
                return self.cash + self.inventory * reference
            return self.cash + self._liquidation(self.inventory, reference)["net"]

    def book_nav(self, ref_price: Decimal) -> Decimal:
        return self.nav(ref_price, executable=False)

    def plan_buy(self, ref_price: Decimal, stop: Decimal, target: Decimal,
                 risk_limit: Decimal, daily_headroom: Decimal) -> dict[str, Any]:
        """Largest full-fill quantity below cash/risk caps; never round size up.

        Full-fill planned risk and actual partial-fill outcomes are deliberately
        distinct: entry partial sensitivity may strand inventory below minimum.
        Previous inventory participates in both executable NAV and stop proceeds.
        """
        blocked: dict[str, Any] = {"eligible": False, "reasons": [], "quantity": ZERO}
        try:
            with localcontext() as context:
                context.prec = 50
                reference, stop, target, requested_risk, headroom = map(
                    exact, (ref_price, stop, target, risk_limit, daily_headroom))
                buy_price = self._price(reference, buy=True)
                stop = floor_step(stop, TICK)
                target = floor_step(target, TICK)
                if not ZERO < stop < buy_price < target:
                    return {**blocked, "reasons": ["invalid_entry_stop_target"]}
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
                    next_inventory = self.inventory + quantity - base_fee
                    stop_sale = self._liquidation(next_inventory, stop)
                    target_sale = self._liquidation(next_inventory, target)
                    if not stop_sale["eligible"]:
                        reasons.add("stop_exit_below_minimum_after_base_fee")
                        continue
                    if not target_sale["eligible"]:
                        reasons.add("target_exit_below_minimum_after_base_fee")
                        continue
                    stop_nav = self.cash - cost + stop_sale["net"]
                    target_nav = self.cash - cost + target_sale["net"]
                    stop_loss = max(ZERO, before_nav - stop_nav)
                    target_profit = target_nav - before_nav
                    if stop_loss > effective_risk:
                        reasons.add("planned_stop_risk_exceeds_headroom")
                        continue
                    if target_profit <= ZERO:
                        reasons.add("target_net_profit_not_positive")
                        continue
                    return {"eligible": True, "reasons": [], "quantity": quantity,
                            "ref_price": reference, "stop": stop, "target": target,
                            "buy_price": buy_price, "reserved_cost": cost,
                            "entry_fee_sol": base_fee, "net_bought_sol": quantity - base_fee,
                            "sellableqty": stop_sale["quantity"],
                            "sellable_quantity": stop_sale["quantity"],
                            "stop_price": stop_sale["price"], "target_price": target_sale["price"],
                            "stop_loss": stop_loss, "target_profit": target_profit,
                            "before_nav": before_nav, "stop_nav": stop_nav, "target_nav": target_nav,
                            "risk_limit": requested_risk, "daily_headroom": headroom,
                            "effective_risk_limit": effective_risk,
                            "account_cash": self.cash, "account_inventory": self.inventory,
                            "cash_after_full_fill": self.cash - cost,
                            "full_fill_assumed": True}
                if max_lots < min_lots:
                    reasons.add("entry_below_minimum_under_cash_cap")
                return {**blocked, "reasons": sorted(reasons) or ["no_valid_quantity"]}
        except (ValueError, InvalidOperation, ArithmeticError):
            return {**blocked, "reasons": ["unknown_or_invalid_decimal_input"]}

    @staticmethod
    def _rejected(reason: str, **fields: Any) -> dict[str, Any]:
        return {"eligible": False, "reasons": [reason], **fields}

    def apply_fill(self, fill: Mapping[str, Any]) -> dict[str, Any]:
        """Apply one simulated fill once. Conflicting duplicate IDs are rejected.

        Quantity is gross base, price is already reserved. BUY order_quantity
        validates the original order minimum while allowing smaller partial fills.
        Fees and deltas are derived here, never trusted from a caller's deltas.
        """
        try:
            with localcontext() as context:
                context.prec = 50
                fill_id, side = fill.get("fill_id"), fill.get("side")
                timestamp = fill.get("timestamp_us")
                if not isinstance(fill_id, str) or not fill_id or side not in ("BUY", "SELL"):
                    return self._rejected("invalid_fill_identity")
                if isinstance(timestamp, bool) or not isinstance(timestamp, int) or timestamp < 0:
                    return self._rejected("invalid_fill_timestamp")
                quantity, price = exact(fill.get("quantity")), exact(fill.get("price"))
                order_quantity = exact(fill.get("order_quantity", quantity))
                identity = {"fill_id": fill_id, "side": side, "timestamp_us": timestamp,
                            "quantity": quantity, "price": price, "order_quantity": order_quantity,
                            "setup_id": fill.get("setup_id"), "reason": fill.get("reason")}
                if fill_id in self._fills:
                    previous = self._fills[fill_id]
                    if any(previous[key] != value for key, value in identity.items()):
                        return self._rejected("conflicting_duplicate_fill", fill_id=fill_id)
                    return {**previous, "duplicate": True}
                if quantity < STEP or quantity % STEP or price <= ZERO or price % TICK:
                    return self._rejected("fill_tick_or_quantity_invalid")
                if order_quantity < quantity or order_quantity % STEP:
                    return self._rejected("original_order_quantity_invalid")
                gross = quantity * price
                if side == "BUY":
                    order_cost = order_quantity * price
                    if order_cost < self.min_notional or order_cost > MAX_COST:
                        return self._rejected("original_buy_order_notional_invalid")
                    if order_cost > self.cash - MIN_CASH:
                        return self._rejected("insufficient_cash_for_original_order")
                    if gross > self.cash or self.cash - gross < MIN_CASH:
                        return self._rejected("insufficient_cash_or_reserve")
                    base_fee = ceil_step(quantity * self.buy_fee, FEE_QUANTUM)
                    quote_fee = ZERO
                    if base_fee >= quantity:
                        return self._rejected("base_fee_exceeds_fill")
                    cash_delta, inventory_delta = -gross, quantity - base_fee
                else:
                    if quantity > self.inventory:
                        return self._rejected("oversell")
                    if gross < self.min_notional:
                        return self._rejected("sell_below_minimum")
                    base_fee, quote_fee = ZERO, ceil_step(gross * self.sell_fee, FEE_QUANTUM)
                    if quote_fee > gross:
                        return self._rejected("quote_fee_exceeds_proceeds")
                    cash_delta, inventory_delta = gross - quote_fee, -quantity
                next_cash, next_inventory = self.cash + cash_delta, self.inventory + inventory_delta
                if next_cash < ZERO or next_inventory < ZERO:
                    return self._rejected("negative_ledger_balance")
                event = {**identity, "eligible": True, "reasons": [], "duplicate": False,
                         "status": "PARTIALLY_FILLED_CANCELLED" if quantity < order_quantity else "FILLED",
                         "filled_quantity": quantity, "cancelled_quantity": order_quantity - quantity,
                         "gross_quote": gross, "base_fee": base_fee, "quote_fee": quote_fee,
                         "fee": base_fee if side == "BUY" else quote_fee,
                         "fee_asset": "SOL" if side == "BUY" else "USDT",
                         "cash_delta": cash_delta, "quote_delta": cash_delta,
                         "inventory_delta": inventory_delta,
                         "cash_before": self.cash, "cash_after": next_cash,
                         "inventory_before": self.inventory, "inventory_after": next_inventory}
                self.cash, self.inventory = next_cash, next_inventory
                self._fills[fill_id] = dict(event)
                self.events.append(dict(event))
                return dict(event)
        except (ValueError, InvalidOperation, ArithmeticError, TypeError):
            return self._rejected("unknown_or_invalid_fill")

    def buy(self, plan: Mapping[str, Any], timestamp_us: int, setup_id: str) -> dict[str, Any]:
        fill_id = f"BUY:{setup_id}:{timestamp_us}"
        try:
            if fill_id in self._fills:
                quantity = floor_step(exact(plan["quantity"]) * self.partial_fraction, STEP)
                return self.apply_fill({"fill_id": fill_id, "side": "BUY", "timestamp_us": timestamp_us,
                                        "quantity": quantity, "price": plan["buy_price"],
                                        "order_quantity": plan["quantity"], "setup_id": setup_id,
                                        "reason": "ENTRY"})
            if plan.get("eligible") is not True:
                return self._rejected("ineligible_plan")
            if plan.get("account_cash") != self.cash or plan.get("account_inventory") != self.inventory:
                return self._rejected("stale_account_plan")
            current = self.plan_buy(plan["ref_price"], plan["stop"], plan["target"],
                                    plan["risk_limit"], plan["daily_headroom"])
            keys = ("quantity", "buy_price", "reserved_cost", "stop_loss", "target_profit", "sellableqty")
            if current.get("eligible") is not True or any(current[key] != plan.get(key) for key in keys):
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
                event.update({"planned_full_fill_stop_loss": plan["stop_loss"],
                              "actual_fill_stop_loss": max(ZERO, plan["before_nav"] - self.nav(plan["stop"])),
                              "partial_stranded_at_stop": not stop_liquidation["eligible"],
                              "requested_quantity": plan["quantity"]})
                # Keep receipt metadata in the stored event so duplicate replays match.
                self._fills[fill_id].update(event)
                self.events[-1].update(event)
            return event
        except (KeyError, ValueError, TypeError, InvalidOperation, ArithmeticError):
            return self._rejected("unknown_or_invalid_plan")

    def sell(self, ref_price: Decimal, timestamp_us: int, reason: str) -> dict[str, Any]:
        fill_id = f"SELL:{reason}:{timestamp_us}"
        try:
            exact(self.cash)
            exact(self.inventory)
            if fill_id in self._fills:
                previous = self._fills[fill_id]
                return self.apply_fill({"fill_id": fill_id, "side": "SELL", "timestamp_us": timestamp_us,
                                        "quantity": previous["quantity"], "price": self._price(ref_price),
                                        "order_quantity": previous["order_quantity"], "reason": reason})
            sale = self._liquidation(self.inventory, ref_price)
            if not sale["eligible"]:
                return self._rejected("inventory_unsellable_at_exit", status="NO_EXIT",
                                      quantity=sale["quantity"], price=sale["price"], inventory=self.inventory)
            return self.apply_fill({"fill_id": fill_id, "side": "SELL", "timestamp_us": timestamp_us,
                                    "quantity": sale["quantity"], "price": sale["price"],
                                    "order_quantity": sale["quantity"], "reason": reason})
        except (ValueError, InvalidOperation, ArithmeticError, TypeError):
            return self._rejected("unknown_or_invalid_exit")
