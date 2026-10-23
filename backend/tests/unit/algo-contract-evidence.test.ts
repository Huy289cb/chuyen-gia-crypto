import { describe, it, expect } from 'vitest';
import { captureAlgoContractEvidence } from '../../src/utils/algo-contract-evidence';
describe('algo wire contract evidence', () => {
  it('keeps actual request and response fields distinct through JSON', () => {
    const data = JSON.parse(JSON.stringify(captureAlgoContractEvidence({ quantity: '0.001', triggerPrice: '90', reduceOnly: true },
      { algoId: 12, quantity: '0.002', triggerPrice: '91', algoStatus: 'NEW', workingType: 'CONTRACT_PRICE', reduceOnly: false })));
    expect(data.request.quantity).toBe('0.001'); expect(data.response.quantity).toBe('0.002');
    expect(data.request.triggerPrice).toBe('90'); expect(data.response.triggerPrice).toBe('91');
    expect(data.request.reduceOnly).toBe(true); expect(data.response.reduceOnly).toBe(false);
    expect(data.request.workingType).toBeNull(); expect(data.response.workingType).toBe('CONTRACT_PRICE');
    expect(data.response.algoStatus).toBe('NEW'); expect(data.response.status).toBeNull();
  });
  it('excludes secrets, arbitrary objects, malformed values and invented defaults', () => {
    const data = captureAlgoContractEvidence(null, { headers: { authorization: 'secret' }, signature: 'secret', quantity: {},
      triggerPrice: NaN, algoId: Infinity, side: 'x'.repeat(257) });
    expect(JSON.stringify(data)).not.toContain('secret');
    for (const field of ['quantity','triggerPrice','algoId','side','reduceOnly','closePosition']) expect(data.response[field]).toBeNull();
    expect(captureAlgoContractEvidence(undefined, undefined).response.workingType).toBeNull();
  });
});
