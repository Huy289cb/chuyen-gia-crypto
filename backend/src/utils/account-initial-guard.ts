/** Shared initial admission decision; the caller applies the cooldown clear. */
export function evaluateAccountInitialGuard(input: {
  protectiveBlock: { reason: string } | null;
  cooldownUntil: Date | null;
  now: Date;
  consecutiveLosses: number | null;
  maxConsecutiveLosses: number;
}) {
  if (input.protectiveBlock) {
    return {
      allowed: false as const,
      reason: `Protective exposure audit blocked entries: ${input.protectiveBlock.reason}`,
      clearExpiredCooldown: false,
    };
  }
  if (input.cooldownUntil && input.cooldownUntil > input.now) {
    return {
      allowed: false as const,
      reason: `Account cooldown active until ${input.cooldownUntil.toISOString()} (${input.consecutiveLosses ?? 0} consecutive losses, max ${input.maxConsecutiveLosses})`,
      clearExpiredCooldown: false,
    };
  }
  return {
    allowed: true as const,
    reason: null,
    clearExpiredCooldown: !!input.cooldownUntil && input.cooldownUntil <= input.now,
  };
}
