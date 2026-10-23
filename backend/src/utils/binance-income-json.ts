/** Binance income transaction IDs are int64 and must not pass through a JS number. */
export function parseBinanceIncomeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  return JSON.parse(raw.replace(/("tranId"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'));
}
