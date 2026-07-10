import { describe, it, expect } from 'vitest';
import { parsePendingOrderDecisions } from '../../src/utils/pending-order-decisions';

describe('pending-order-decisions', () => {
  it('parses valid decisions', () => {
    const parsed = parsePendingOrderDecisions([
      {
        order_id: 'v3_123',
        action: 'cancel',
        confidence: 0.9,
        reason: 'setup invalid',
      },
      {
        order_id: 'v3_456',
        action: 'hold',
        confidence: 0.6,
        reason: 'wait',
      },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].action).toBe('cancel');
    expect(parsed[0].confidence).toBe(0.9);
  });

  it('rejects modify without fields', () => {
    const parsed = parsePendingOrderDecisions([
      {
        order_id: 'v3_789',
        action: 'modify',
        confidence: 0.85,
        reason: 'tweak',
      },
    ]);
    expect(parsed).toHaveLength(0);
  });
});
