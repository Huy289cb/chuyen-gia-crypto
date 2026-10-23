export interface OccupancyRow {side:unknown;status?:string|null;order_id?:string;}
/** Exact production branch order and lazy policy reads; null means only this stage permits continuation. */
export function evaluateEntryOccupancy(input:{opportunityContract:boolean;side:'long'|'short';openPositions:readonly OccupancyRow[];pendingOrders:readonly OccupancyRow[];maxPositionsPerSymbol:number;scaleInEnabled:()=>boolean;flipEnabled:()=>boolean}){
 const {opportunityContract,side,openPositions,pendingOrders,maxPositionsPerSymbol,scaleInEnabled,flipEnabled}=input;
  if (opportunityContract && (openPositions.length > 0 || pendingOrders.length > 0)) {
    return { success: false as const, reason: 'AI opportunity requires flat account without pending orders' };
  }

  const scaleIn = !opportunityContract && scaleInEnabled();
  const opposite = side === 'long' ? 'short' : 'long';

  if (scaleIn) {
    const oppositeOpen = openPositions.filter(
      (p) => String(p.side).toLowerCase() === opposite
    );
    if (oppositeOpen.length > 0 && !flipEnabled()) {
      return {
        success: false as const,
        reason: `Opposite ${opposite} position open — cannot open ${side}`,
      };
    }

    const oppositePending = pendingOrders.filter(
      (o) => String(o.side).toLowerCase() === opposite
    );
    if (oppositePending.length > 0) {
      return {
        success: false as const,
        reason: `Opposite ${opposite} pending order exists`,
      };
    }

    const unresolved = pendingOrders.filter(
      (o) => o.status === 'reconciliation_failed_not_on_binance'
    );
    if (unresolved.length > 0) {
      const blocking = unresolved[0];
      return {
        success: false as const,
        reason: `Unresolved ${side} pending order ${blocking.order_id} (reconcile pending — Binance state unknown)`,
      };
    }
  } else {
    const sameSideOpen = openPositions.filter(
      (p) => String(p.side).toLowerCase() === side
    );
    if (sameSideOpen.length > 0) {
      return {
        success: false as const,
        reason: `Same-side ${side} position already open (scaling-in disabled)`,
      };
    }

    const sameSidePending = pendingOrders.filter(
      (o) => String(o.side).toLowerCase() === side
    );
    if (sameSidePending.length > 0) {
      const blocking = sameSidePending[0];
      const status = String(blocking.status ?? 'pending');
      return {
        success: false as const,
        reason:
          status === 'reconciliation_failed_not_on_binance'
            ? `Unresolved ${side} pending order ${blocking.order_id} (reconcile pending — Binance state unknown)`
            : `Same-side ${side} pending order already exists`,
      };
    }

    const maxPerSymbol = maxPositionsPerSymbol;
    if (openPositions.length >= maxPerSymbol || pendingOrders.length >= maxPerSymbol) {
      return {
        success: false as const,
        reason: `Max positions/orders per symbol (${maxPerSymbol}) reached`,
      };
    }
  }

 return null;
}
