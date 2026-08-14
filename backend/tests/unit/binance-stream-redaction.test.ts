import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, putMock, delMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  putMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock('../../src/services/binance/client', () => ({
  post: postMock,
  put: putMock,
  del: delMock,
}));

describe('Binance user-stream logging', () => {
  const listenKey = 'sensitive-listen-key-value';
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    postMock.mockReset().mockResolvedValue({ listenKey });
    putMock.mockReset().mockResolvedValue({});
    delMock.mockReset().mockResolvedValue({});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('never writes the listen key into lifecycle logs', async () => {
    const { startListenKey, keepAliveListenKey, closeListenKey } = await import(
      '../../src/services/binance/stream'
    );

    expect(await startListenKey()).toBe(listenKey);
    await keepAliveListenKey(listenKey);
    await closeListenKey(listenKey);

    const renderedLogs = logSpy.mock.calls.flat().map(String).join(' ');
    expect(renderedLogs).not.toContain(listenKey);
    expect(renderedLogs).toContain('Listen key created');
    expect(renderedLogs).toContain('Listen key kept alive');
    expect(renderedLogs).toContain('Listen key closed');
  });
});
