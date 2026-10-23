"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBinanceIncomeJson = parseBinanceIncomeJson;
/** Binance income transaction IDs are int64 and must not pass through a JS number. */
function parseBinanceIncomeJson(raw) {
    if (typeof raw !== 'string')
        return raw;
    return JSON.parse(raw.replace(/("tranId"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'));
}
//# sourceMappingURL=binance-income-json.js.map