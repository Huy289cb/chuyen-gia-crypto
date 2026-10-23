import type { TradeNotifyPayload } from './message-formatters';
export declare function setTelegramRealtimeMuted(muted: boolean): void;
export declare function isTelegramRealtimeMuted(): boolean;
export declare function notifyTrade(payload: TradeNotifyPayload, dedupKey?: string): void;
export declare function notifyAlert(title: string, body: string, dedupKey?: string, debounceMs?: number): void;
export declare function notifyVerbose(title: string, body: string, dedupKey?: string): void;
export declare function notifyFromTradeEvent(eventType: string, eventData: Record<string, unknown> | null | undefined, positionId?: string): void;
//# sourceMappingURL=telegram-notify.service.d.ts.map