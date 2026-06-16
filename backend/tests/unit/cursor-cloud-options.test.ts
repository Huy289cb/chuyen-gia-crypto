import { describe, expect, it } from 'vitest';
import { buildCloudAgentOptions } from '../../src/services/telegram/cursor-cloud-options';

describe('buildCloudAgentOptions', () => {
  it('chat mode: no auto PR', () => {
    const opts = buildCloudAgentOptions({ model: 'composer-2.5', autoCreatePR: false });
    expect(opts.cloud?.autoCreatePR).toBe(false);
    expect(opts.model).toEqual({ id: 'composer-2.5' });
  });

  it('fix mode: auto PR', () => {
    const opts = buildCloudAgentOptions({ model: 'composer-2.5', autoCreatePR: true });
    expect(opts.cloud?.autoCreatePR).toBe(true);
  });
});
