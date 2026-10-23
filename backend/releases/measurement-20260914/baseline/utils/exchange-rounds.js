"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconstructExchangeRounds = reconstructExchangeRounds;
function reconstructExchangeRounds(fills, income = []) {
    const unique = new Map();
    for (const f of fills) {
        if (![f.price, f.qty, f.commission, f.realizedPnl, f.time].every(Number.isFinite) || f.qty <= 0 || f.price <= 0) {
            throw new Error('Invalid exchange fill');
        }
        if (f.commissionAsset && f.commissionAsset !== 'USDT')
            throw new Error('Non-USDT commission requires conversion');
        if (!['BUY', 'SELL'].includes(f.side.toUpperCase()))
            throw new Error('Invalid fill side');
        const key = f.tradeId != null ? String(f.tradeId) : JSON.stringify(f);
        unique.set(key, f);
    }
    const sorted = [...unique.values()].sort((a, b) => a.time - b.time || Number(a.tradeId ?? 0) - Number(b.tradeId ?? 0));
    const rounds = [];
    let signedQty = 0;
    let current = null;
    let entryValue = 0;
    let exitValue = 0;
    const epsilon = 1e-10;
    for (const f of sorted) {
        const direction = f.side.toUpperCase() === 'BUY' ? 1 : -1;
        let remaining = f.qty;
        if (!current && Math.abs(f.realizedPnl) > epsilon) {
            // Opening inventory predates this sample. Do not fabricate a complete round.
            continue;
        }
        if (current && Math.sign(signedQty) !== direction) {
            const closingQty = Math.min(Math.abs(signedQty), remaining);
            exitValue += closingQty * f.price;
            current.grossPnl += f.realizedPnl;
            current.exitFee += f.commission * closingQty / f.qty;
            current.fills.push(f);
            signedQty += direction * closingQty;
            remaining -= closingQty;
            if (Math.abs(signedQty) <= epsilon) {
                current.closeTime = f.time;
                current.entryPrice = entryValue / current.quantity;
                current.closePrice = exitValue / current.quantity;
                const fundingUnique = new Map();
                for (const row of income) {
                    if (row.incomeType === 'FUNDING_FEE' && row.time >= current.entryTime && row.time <= current.closeTime) {
                        if (row.asset && row.asset !== 'USDT')
                            throw new Error('Non-USDT funding requires conversion');
                        fundingUnique.set(String(row.tranId ?? JSON.stringify(row)), row);
                    }
                }
                current.funding = [...fundingUnique.values()];
                current.fundingFee = -current.funding.reduce((sum, row) => sum + Number(row.income), 0);
                current.netPnl = current.grossPnl - current.entryFee - current.exitFee - current.fundingFee;
                rounds.push(current);
                current = null;
                signedQty = 0;
            }
        }
        if (remaining > epsilon) {
            if (!current) {
                current = { side: direction > 0 ? 'long' : 'short', entryTime: f.time, closeTime: 0,
                    entryPrice: 0, closePrice: 0, quantity: 0, grossPnl: 0, entryFee: 0, exitFee: 0,
                    fundingFee: 0, netPnl: 0, fills: [], funding: [] };
                entryValue = 0;
                exitValue = 0;
            }
            signedQty += direction * remaining;
            current.quantity += remaining;
            entryValue += remaining * f.price;
            current.entryFee += f.commission * remaining / f.qty;
            current.fills.push(f);
        }
    }
    return rounds;
}
//# sourceMappingURL=exchange-rounds.js.map