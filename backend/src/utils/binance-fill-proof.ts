/** Position was opened via a verified Binance fill — never bookkeeping-close. */
export function hasBinanceFillProof(position: {
  binance_order_id?: string | null;
}): boolean {
  return Boolean(position.binance_order_id?.trim());
}
