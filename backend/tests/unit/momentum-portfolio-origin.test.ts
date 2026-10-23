import { describe, expect, it } from 'vitest';
import { isPaperSameOrigin } from '../../src/config/cors';
const request = (path: string, origin: string, host = '132.226.2.93') => ({ path, protocol: 'http', get: (name: string) => name === 'origin' ? origin : host }) as Parameters<typeof isPaperSameOrigin>[0];
describe('backend paper page origin', () => {
  it('allows its exact own origin for paper actions', () => {
    expect(isPaperSameOrigin(request('/api/portfolio-paper/testbed', 'http://132.226.2.93'))).toBe(true);
  });
  it('keeps other origins and other APIs on their existing allowlist', () => {
    expect(isPaperSameOrigin(request('/api/portfolio-paper/testbed', 'https://example.com'))).toBe(false);
    expect(isPaperSameOrigin(request('/api/testnet/orders', 'http://132.226.2.93'))).toBe(false);
    expect(isPaperSameOrigin(request('/api/portfolio-paper-extra', 'http://132.226.2.93'))).toBe(false);
    expect(isPaperSameOrigin(request('/api/portfolio-paper/testbed', 'http://132.226.2.93:3000'))).toBe(false);
  });
});
