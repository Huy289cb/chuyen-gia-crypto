/** Reuse Intl instances in long historical replays; identical to toLocaleString options. */
const formatters = new Map<number, Intl.NumberFormat>();
export function formatSetupNumber(value: number, digits = 2): string {
  let formatter = formatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits });
    formatters.set(digits, formatter);
  }
  return formatter.format(value);
}
