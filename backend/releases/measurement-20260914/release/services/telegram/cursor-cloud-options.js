"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCloudAgentOptions = buildCloudAgentOptions;
const telegram_ai_1 = require("../../config/telegram-ai");
function buildCloudAgentOptions(opts) {
    return {
        apiKey: telegram_ai_1.cursorAgentConfig.apiKey,
        model: { id: opts.model },
        cloud: {
            repos: [
                {
                    url: telegram_ai_1.cursorAgentConfig.repoUrl,
                    startingRef: telegram_ai_1.cursorAgentConfig.baseBranch,
                },
            ],
            autoCreatePR: opts.autoCreatePR,
            skipReviewerRequest: true,
        },
    };
}
//# sourceMappingURL=cursor-cloud-options.js.map