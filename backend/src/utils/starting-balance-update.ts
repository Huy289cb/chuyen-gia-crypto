/** Exact local capital-field assignment; no transfer/economic capital inference. */
export function buildStartingBalanceUpdate(walletBalance: number) {
  return { starting_balance: walletBalance };
}
