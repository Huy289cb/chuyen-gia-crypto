import { describe, it, expect } from 'vitest';
import { isPendingOrderTerminal } from '../../src/services/pending-order-actions';

describe('isPendingOrderTerminal', () => {
  it('treats cancelled_ttl_expired as terminal', () => {
    expect(isPendingOrderTerminal('cancelled_ttl_expired')).toBe(true);
  });

  it('treats pending as active', () => {
    expect(isPendingOrderTerminal('pending')).toBe(false);
    expect(isPendingOrderTerminal('partially_filled')).toBe(false);
  });

  it('treats executed as terminal', () => {
    expect(isPendingOrderTerminal('executed')).toBe(true);
  });
});
