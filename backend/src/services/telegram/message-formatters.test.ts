import { describe, it, expect } from 'vitest';
import { escapeHtml, mapTradeEventType } from './message-formatters';

describe('message-formatters', () => {
  it('escapeHtml escapes special chars', () => {
    expect(escapeHtml('<a&b>')).toBe('&lt;a&amp;b&gt;');
  });

  it('mapTradeEventType returns title for known events', () => {
    expect(mapTradeEventType('position_closed')).toContain('Đóng');
    expect(mapTradeEventType('unknown_xyz')).toBeNull();
  });
});
