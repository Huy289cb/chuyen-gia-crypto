"""Offline conditional100USDT research ledger: one cash balance, owned dust.

Market filters are a pinned current scenario, not historical exchange receipts.
Nothing here imports a broker or modifies the frozen15USDT BTC baseline.
"""
from __future__ import annotations
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, localcontext
from copy import deepcopy
from typing import Any, Mapping

D = Decimal
FEE = D('.001')
FEE_QUANTUM = D('.00000001')


def exact(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (D, str, int)):
        raise ValueError('finite nonnegative exact Decimal required')
    number = D(value)
    if not number.is_finite() or number < 0:
        raise ValueError('finite nonnegative exact Decimal required')
    return number


def floor(value: Decimal, step: Decimal) -> Decimal:
    return (value / step).to_integral_value(rounding=ROUND_FLOOR) * step


def ceil(value: Decimal, step: Decimal) -> Decimal:
    return (value / step).to_integral_value(rounding=ROUND_CEILING) * step


class Account:
    """Only full simulated fills; one active inventory plus per-market dust."""
    def __init__(self, exchange_info: Mapping, slip: Decimal, initial_cash: Decimal = D(100)):
        self.initial_cash = self.cash = exact(initial_cash)
        if self.cash != 100:
            raise ValueError('this conditional research version requires totalSpot100')
        self.slip = exact(slip)
        if self.slip not in (D('.001'), D('.003')):
            raise ValueError('only registered base/stress slippage scenarios')
        self.markets = {}
        for record in exchange_info['symbols']:
            filters = {f['filterType']: f for f in record['filters']}
            size, price, notional = filters['LOT_SIZE'], filters['PRICE_FILTER'], filters['NOTIONAL']
            symbol = record['symbol']
            if record['status'] != 'TRADING' or not symbol.endswith('USDT'):
                raise ValueError('only pinnedTRADING USDTpairs')
            market = {'step': exact(size['stepSize']), 'min_qty': exact(size['minQty']),
                      'max_qty': exact(size['maxQty']), 'tick': exact(price['tickSize']),
                      'min_notional': exact(notional['minNotional']),
                      'avg_price_mins': notional['avgPriceMins']}
            if min(market['step'], market['tick'], market['min_notional'], market['min_qty']) <= 0:
                raise ValueError('positive pinnedLOT_SIZE/PRICE_FILTER/NOTIONAL required')
            market_size = filters.get('MARKET_LOT_SIZE', {})
            if market_size.get('maxQty') and exact(market_size['maxQty']) > 0:
                market['max_qty'] = min(market['max_qty'], exact(market_size['maxQty']))
            if symbol in self.markets or market['avg_price_mins'] != 5:
                raise ValueError('unique markets and explicit5minute reference proxy required')
            self.markets[symbol] = market
        self.inventory = {symbol: D(0) for symbol in self.markets}
        self.active_symbol: str | None = None
        self.events: list[dict] = []
        self._fills: dict[str, dict] = {}
        self._requests: dict[str, Any] = {}

    def price(self, symbol: str, reference: Decimal, *, buy: bool = False) -> Decimal:
        value = exact(reference)
        if value <= 0:
            raise ValueError('positive reference required')
        with localcontext() as context:
            context.prec = 50
            p = value * (1 + self.slip if buy else 1 - self.slip)
            return (ceil if buy else floor)(p, self.markets[symbol]['tick'])

    def liquidation(self, symbol: str, inventory: Decimal, reference: Decimal,
                    proxy: Decimal | None) -> dict:
        m = self.markets[symbol]
        with localcontext() as context:
            context.prec = 50
            quantity = floor(exact(inventory), m['step'])
            price = self.price(symbol, reference)
            gross = quantity * price
            fee = ceil(gross * FEE, FEE_QUANTUM)
            minimum_at_proxy = None if proxy is None else quantity * exact(proxy)
            reasons = []
            if not m['min_qty'] <= quantity <= m['max_qty']:
                reasons.append('SELL_QUANTITY_FILTER')
            if gross < m['min_notional']:
                reasons.append('SELL_FILL_PRICE_MINIMUM')
            if minimum_at_proxy is None or minimum_at_proxy < m['min_notional']:
                reasons.append('SELL_REFERENCE_MINIMUM_UNKNOWN_OR_BELOW')
            return {'eligible': not reasons, 'reasons': reasons, 'quantity': quantity,
                    'price': price, 'gross': gross, 'fee': fee,
                    'net': gross - fee if not reasons else D(0),
                    'reference_notional': minimum_at_proxy,
                    'reference_policy': 'PRIOR5_COMPLETED_1M_WAP_PROXY',
                    'historical_filter_or_actual_avgPrice_verified': False}

    def nav(self, references: Mapping[str, Decimal], proxies: Mapping[str, Decimal | None],
            *, book: bool = False) -> Decimal:
        with localcontext() as context:
            context.prec = 50
            value = self.cash
            for symbol, quantity in self.inventory.items():
                if not quantity or (not book and quantity < self.markets[symbol]["min_qty"]):
                    continue
                if symbol not in references:
                    raise ValueError('owned asset missing currentmark')
                value += (quantity * exact(references[symbol]) if book else
                          self.liquidation(symbol, quantity, references[symbol], proxies.get(symbol))['net'])
            return value

    def plan_entry(self, symbol: str, reference: Decimal, stop_distance: Decimal,
                   headroom: Decimal, references: Mapping[str, Decimal],
                   proxies: Mapping[str, Decimal | None]) -> dict:
        blocked = {'eligible': False, 'quantity': D(0), 'reasons': []}
        if self.active_symbol is not None:
            return {**blocked, 'reasons': ['ACTIVE_POSITION_OCCUPIED']}
        with localcontext() as context:
            context.prec = 50
            m = self.markets[symbol]
            ref, distance, remaining = map(exact, (reference, stop_distance, headroom))
            buy_price = self.price(symbol, ref, buy=True)
            stop = floor(buy_price - distance, m['tick'])
            if not 0 < stop < buy_price:
                return {**blocked, 'reasons': ['INVALID_STATIC_STOP']}
            if stop >= ref:
                return {**blocked, 'reasons': ['STATIC_STOP_ALREADY_TRIGGERED_AT_OPEN']}
            proxy = proxies.get(symbol)
            if proxy is None or exact(proxy) <= 0:
                return {**blocked, 'reasons': ['ENTRY_REFERENCE_MINIMUM_UNKNOWN']}
            before_nav = self.nav(references, proxies)
            reserve = before_nav * D('.20')
            budget = min(before_nav * D('.80'), self.cash - reserve)
            risk_limit = min(before_nav * D('.20'), remaining)
            if budget <= 0 or risk_limit <= 0:
                return {**blocked, 'reasons': ['CASH_RESERVE_OR_DAILY_HEADROOM']}
            sale_stop = self.price(symbol, stop)
            sale_flat = self.price(symbol, ref)
            if min(sale_stop, sale_flat) <= 0:
                return {**blocked, 'reasons': ['STOP_OR_FLAT_SALE_PRICE_ZERO']}
            required_sell = ceil(max(m['min_qty'], m['min_notional'] / sale_stop,
                                     m['min_notional'] / sale_flat,
                                     m['min_notional'] / exact(proxy)), m['step'])
            quantity_min = ceil(max(m['min_qty'], m['min_notional'] / buy_price,
                                     m['min_notional'] / exact(proxy), required_sell / (1 - FEE)), m['step'])
            # Fee ceiling can require one more lot than the unrounded bound.
            while floor(quantity_min - ceil(quantity_min * FEE, FEE_QUANTUM), m['step']) < required_sell:
                quantity_min += m['step']
            low = int(quantity_min / m['step'])
            high = int(floor(min(budget / buy_price, m['max_qty']), m['step']) / m['step'])
            if low > high:
                return {**blocked, 'reasons': ['POST_FEE_STOP_FLAT_MINIMUM_UNDER_BUDGET']}
            old_liq = self.liquidation(symbol, self.inventory[symbol], ref, proxy)['net']
            other_net = before_nav - self.cash - old_liq

            def evaluate(lots):
                quantity = m['step'] * lots
                cost = quantity * buy_price
                base_fee = ceil(quantity * FEE, FEE_QUANTUM)
                net_bought = quantity - base_fee
                solo_stop = self.liquidation(symbol, net_bought, stop, proxy)
                solo_flat = self.liquidation(symbol, net_bought, ref, proxy)
                combined_stop = self.liquidation(symbol, self.inventory[symbol] + net_bought, stop, proxy)
                stop_nav = self.cash - cost + other_net + combined_stop['net']
                solo_loss = cost - solo_stop['net']
                planned_risk = max(D(0), before_nav - stop_nav, solo_loss)
                return quantity, cost, base_fee, net_bought, solo_stop, solo_flat, stop_nav, planned_risk

            # Risk is monotone in gross lots: each next gross lot increases sold
            # lots by zero or one; buyprice always exceeds net stopprice.
            best = None
            while low <= high:
                mid = (low + high) // 2
                result = evaluate(mid)
                if result[-1] <= risk_limit:
                    best = result
                    low = mid + 1
                else:
                    high = mid - 1
            if best is None:
                return {**blocked, 'reasons': ['STOP_RISK_EXCEEDS_REMAINING_HEADROOM']}
            quantity, cost, base_fee, net_bought, solo_stop, solo_flat, stop_nav, planned_risk = best
            if not solo_stop['eligible'] or not solo_flat['eligible']:
                return {**blocked, 'reasons': ['POST_FEE_STANDALONE_MINIMUM']}
            return {'eligible': True, 'reasons': [], 'symbol': symbol, 'quantity': quantity,
                    'reference': ref, 'stop_distance': distance, 'stop': stop,
                    'buy_price': buy_price, 'reserved_cost': cost, 'buy_fee_base': base_fee,
                    'net_bought_base': net_bought, 'solo_stop_net': solo_stop['net'],
                    'solo_flat_net': solo_flat['net'], 'planned_risk': planned_risk,
                    'before_nav': before_nav, 'stop_nav': stop_nav,
                    'entry_budget': budget, 'cash_reserve_required': reserve,
                    'risk_limit': risk_limit, 'daily_headroom': remaining,
                    'cash_before': self.cash, 'inventories_before': dict(self.inventory),
                    'references': dict(references), 'proxies': dict(proxies),
                    'reference_notional': quantity * exact(proxy),
                    'historical_filter_or_actual_avgPrice_verified': False}

    def buy(self, plan: Mapping, at_us: int, episode_id: str) -> dict:
        fill_id = f'BUY:{episode_id}:{at_us}'
        if fill_id in self._fills:
            if dict(plan) != self._requests[fill_id]:
                return {'eligible': False, 'reasons': ['MODIFIED_DUPLICATE_PLAN']}
            return {**self._fills[fill_id], 'duplicate': True}
        if type(at_us) is not int or at_us < 0 or not isinstance(episode_id, str) or not episode_id:
            return {'eligible': False, 'reasons': ['INVALID_FILL_IDENTITY']}
        if plan.get('eligible') is not True:
            return {'eligible': False, 'reasons': ['INELIGIBLE_PLAN']}
        current = self.plan_entry(plan['symbol'], plan['reference'], plan['stop_distance'],
                                  plan['daily_headroom'], plan['references'], plan['proxies'])
        if current != dict(plan):
            return {'eligible': False, 'reasons': ['STALE_OR_MODIFIED_PLAN']}
        symbol = plan['symbol']
        event = {'eligible': True, 'reasons': [], 'fill_id': fill_id, 'side': 'BUY',
                 'timestamp_us': at_us, 'symbol': symbol, 'episode_id': episode_id,
                 'reason': 'ENTRY', 'quantity': plan['quantity'], 'price': plan['buy_price'],
                 'gross_quote': plan['reserved_cost'], 'base_fee': plan['buy_fee_base'],
                 'quote_fee': D(0), 'cash_before': self.cash,
                 'inventories_before': dict(self.inventory), 'planned_risk': plan['planned_risk'],
                 'initial_stop': plan['stop'], 'entry_budget': plan['entry_budget'],
                 'risk_limit': plan['risk_limit'], 'daily_headroom': plan['daily_headroom'],
                 'cash_reserve_required': plan['cash_reserve_required'], 'before_nav': plan['before_nav']}
        self.cash -= plan['reserved_cost']
        self.inventory[symbol] += plan['net_bought_base']
        self.active_symbol = symbol
        event.update(cash_after=self.cash, inventories_after=dict(self.inventory),
                     cash_delta=-plan['reserved_cost'], inventory_delta=plan['net_bought_base'], duplicate=False)
        self.events.append(event)
        self._fills[fill_id] = dict(event)
        self._requests[fill_id] = deepcopy(dict(plan))
        return event

    def sell(self, symbol: str, reference: Decimal, proxy: Decimal | None,
             at_us: int, reason: str) -> dict:
        fill_id = f'SELL:{symbol}:{reason}:{at_us}'
        request = (symbol, exact(reference), proxy, at_us, reason)
        if fill_id in self._fills:
            if request != self._requests[fill_id]:
                return {'eligible': False, 'reasons': ['MODIFIED_DUPLICATE_SALE']}
            return {**self._fills[fill_id], 'duplicate': True}
        if type(at_us) is not int or at_us < 0 or self.active_symbol != symbol:
            return {'eligible': False, 'reasons': ['INVALID_OR_UNOWNED_ACTIVE_SALE']}
        result = self.liquidation(symbol, self.inventory[symbol], reference, proxy)
        if not result['eligible']:
            return result
        event = {'eligible': True, 'reasons': [], 'fill_id': fill_id, 'side': 'SELL',
                 'timestamp_us': at_us, 'symbol': symbol, 'reason': reason,
                 'reference': exact(reference), 'reference_proxy': proxy,
                 'quantity': result['quantity'], 'price': result['price'],
                 'gross_quote': result['gross'], 'base_fee': D(0), 'quote_fee': result['fee'],
                 'cash_before': self.cash, 'inventories_before': dict(self.inventory), 'duplicate': False}
        self.cash += result['net']
        self.inventory[symbol] -= result['quantity']
        self.active_symbol = None
        event.update(cash_after=self.cash, inventories_after=dict(self.inventory),
                     cash_delta=result['net'], inventory_delta=-result['quantity'])
        self.events.append(event)
        self._fills[fill_id] = dict(event)
        self._requests[fill_id] = request
        return event
