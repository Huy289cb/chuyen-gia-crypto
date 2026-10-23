export function buildWalletSyncUpdate(snapshot:{walletBalance:number;equity:number;unrealizedPnl:number},updatedAt:Date){
 return {current_balance:snapshot.walletBalance,equity:snapshot.equity,unrealized_pnl:snapshot.unrealizedPnl,updated_at:updatedAt};
}
