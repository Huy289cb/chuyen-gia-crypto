/** Exact existing local precision reset. No account/risk history is reset here. */
export function buildPrecisionResetUpdate(now: Date) {
  return { precision_error_count: 0, precision_cooldown_until: null,
    last_precision_error_time: null, last_precision_error_code: null,
    last_precision_error_message: null, updated_at: now };
}
