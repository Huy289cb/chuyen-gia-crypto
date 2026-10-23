import { expect, it } from 'vitest';
import { parseBinanceIncomeJson } from '../../src/utils/binance-income-json';
it('preserves neighboring int64 transaction IDs instead of merging them after floating point rounding', () => {
  const rows = parseBinanceIncomeJson('[{"tranId":9007199254740992,"income":"-0.01","time":100},{"tranId":9007199254740993,"income":"-0.01","time":100}]') as any[];
  expect(rows.map(r=>r.tranId)).toEqual(['9007199254740992','9007199254740993']);
  expect(rows[0].time).toBe(100);
});
it('preserves Binance error codes as numbers and leaves already parsed payloads unchanged', () => {
  expect(parseBinanceIncomeJson('{"code":-2015,"msg":"denied"}')).toEqual({code:-2015,msg:'denied'});
  const row={tranId:'123'};expect(parseBinanceIncomeJson(row)).toBe(row);
});
