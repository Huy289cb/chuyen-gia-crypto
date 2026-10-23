import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertBinanceMutationAllowed } from '../../src/config/mainnet-safety';

afterEach(() => vi.unstubAllEnvs());

describe('exclusive portfolio exchange ownership', () => {
  it('blocks legacy mutations while keeping signed reads available', () => {
    vi.stubEnv('BINANCE_BASE_URL', 'https://fapi.binance.com');
    vi.stubEnv('MAINNET_LIVE_TRADING_ENABLED', 'true');
    vi.stubEnv('MAINNET_TRADING_ACK', 'I_UNDERSTAND_REAL_MONEY');
    vi.stubEnv('PORTFOLIO_EXECUTION_OWNER', 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1');
    for (const [method, path] of [['POST', '/fapi/v1/order'], ['DELETE', '/fapi/v1/algoOrder'],
      ['POST', '/fapi/v1/leverage'], ['POST', '/fapi/v1/positionSide/dual'], ['POST', '/fapi/v1/positionMargin']]) {
      expect(() => assertBinanceMutationAllowed(method!, path!)).toThrow('execution owner');
      expect(() => assertBinanceMutationAllowed(method!, path!, 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1')).not.toThrow();
    }
    expect(() => assertBinanceMutationAllowed('GET', '/fapi/v3/account')).not.toThrow();
  });

  it('retains the mainnet acknowledgement requirement for the new owner', () => {
    vi.stubEnv('BINANCE_BASE_URL', 'https://fapi.binance.com');
    vi.stubEnv('PORTFOLIO_EXECUTION_OWNER', 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1');
    vi.stubEnv('MAINNET_LIVE_TRADING_ENABLED', 'false');
    expect(() => assertBinanceMutationAllowed('POST', '/fapi/v1/order', 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1'))
      .toThrow('Mainnet trading mutation blocked');
  });

  it('preserves legacy permissions until an owner is assigned', () => {
    vi.stubEnv('BINANCE_BASE_URL', 'https://demo-fapi.binance.com');
    vi.stubEnv('PORTFOLIO_EXECUTION_OWNER', '');
    expect(() => assertBinanceMutationAllowed('POST', '/fapi/v1/order')).not.toThrow();
  });
});
