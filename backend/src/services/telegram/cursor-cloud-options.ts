import type { AgentOptions } from '@cursor/sdk';
import { cursorAgentConfig } from '../../config/telegram-ai';

export function buildCloudAgentOptions(opts: {
  model: string;
  autoCreatePR: boolean;
}): AgentOptions {
  return {
    apiKey: cursorAgentConfig.apiKey,
    model: { id: opts.model },
    cloud: {
      repos: [
        {
          url: cursorAgentConfig.repoUrl,
          startingRef: cursorAgentConfig.baseBranch,
        },
      ],
      autoCreatePR: opts.autoCreatePR,
      skipReviewerRequest: true,
    },
  };
}
