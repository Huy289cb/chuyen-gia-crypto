/**
 * Binance Futures WebSocket User Data Stream Service
 *
 * Handles real-time synchronization from Binance Futures User Data Stream
 * Processes ORDER_TRADE_UPDATE and ACCOUNT_UPDATE events
 */
export declare function startBinanceWebSocketSync(): Promise<void>;
export declare function handleOrderTradeUpdate(event: any): Promise<void>;
export declare function stopBinanceWebSocketSync(): Promise<void>;
//# sourceMappingURL=binance-websocket-sync.d.ts.map