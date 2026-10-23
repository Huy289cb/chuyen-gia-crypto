/** Exact production exposure arithmetic; inputs must come from scoped repository reads. */
export function evaluateSymbolExposure(openPositions:readonly {size_usd:unknown;side:unknown}[],pendingOrders:readonly {size_usd:unknown;side:unknown}[],maxExposureUsd:number){
  const openUsd = openPositions.reduce(
    (sum, p) => sum + Math.abs(Number(p.size_usd) || 0),
    0
  );
  const pendingUsd = pendingOrders.reduce(
    (sum, o) => sum + Math.abs(Number(o.size_usd) || 0),
    0
  );
  const totalUsd = openUsd + pendingUsd;

  const openSides = [
    ...new Set(
      openPositions
        .map((p) => String(p.side).toLowerCase())
        .filter((s): s is 'long' | 'short' => s === 'long' || s === 'short')
    ),
  ];
  const pendingSides = [
    ...new Set(
      pendingOrders
        .map((o) => String(o.side).toLowerCase())
        .filter((s): s is 'long' | 'short' => s === 'long' || s === 'short')
    ),
  ];

  return {
    openUsd,
    pendingUsd,
    totalUsd,
    maxExposureUsd,
    remainingUsd: Math.max(0, maxExposureUsd - totalUsd),
    openSides,
    pendingSides,
  };
}
