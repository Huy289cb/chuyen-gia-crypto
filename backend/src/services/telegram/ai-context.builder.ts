import { prisma } from '../../lib/prisma';
import { getDayBoundsICT, getIctDateString } from '../../utils/ict-time';
import {
  getAccountBalanceSummary,
  getDefaultTradingScope,
  getOpenPositionLines,
  getPendingOrderLines,
  getTodayTradeStatsIct,
  type AccountBalanceSummary,
  type OpenPositionLine,
  type PendingOrderLine,
  type TodayTradeStats,
} from '../account-summary.service';
import {
  getSystemHealthSnapshot,
  getLlmStatsTodayIct,
  getTopNoTradeReasonsIct,
  type SystemHealthSnapshot,
} from '../system-health.service';
import { fetchBinanceNetPosition } from '../binance-exposure.service';

export type AiContextScope =
  | 'today_run'
  | 'errors'
  | 'pipeline'
  | 'llm'
  | 'freeform'
  | 'compare';

export interface AiContextBundle {
  meta: {
    generatedAt: string;
    ictDate: string;
    symbol: string;
    methodId: string;
    scope: AiContextScope;
  };
  account: AccountBalanceSummary;
  todayTrades: TodayTradeStats;
  weekTrades?: WeeklyTradeStats;
  health: SystemHealthSnapshot;
  llm: {
    stats: { total: number; trades: number; noTrades: number };
    weekStats?: { total: number; trades: number; noTrades: number };
    topNoTradeReasons: Array<{ reason: string; count: number }>;
  };
  /** Live Binance net position — authoritative for "có exposure không" */
  binanceExposure: BinanceExposureSnapshot;
  recentDecisions: TradeDecisionRow[];
  recentErrors: ErrorEventRow[];
  openPositions: OpenPositionLine[];
  pendingOrders: PendingOrderLine[];
  recentClosedPositions: RecentClosedPositionRow[];
  /** Plain-language rules for /ai — explain sync simply to operators */
  operatorNotes: string[];
}

export interface BinanceExposureSnapshot {
  available: boolean;
  side: 'long' | 'short' | 'flat' | 'unknown';
  netQty: number;
  entryPrice?: number;
  markPrice?: number;
  note?: string;
}

export interface RecentClosedPositionRow {
  position_id: string;
  side: string;
  entry_price: number;
  close_price: number;
  realized_pnl: number;
  close_reason: string;
  entry_time: string;
  close_time: string;
}

export interface WeeklyTradeStats {
  closedCount: number;
  wins: number;
  losses: number;
  totalRealizedPnl: number;
  totalFees: number;
}

export interface TradeDecisionRow {
  id: number;
  decision: string;
  grade: string;
  confidence: number;
  timeframe: string;
  reason: string;
  timestamp: string;
}

export interface ErrorEventRow {
  event_type: string;
  timestamp: string;
  summary: string;
}

const SECRET_DENYLIST = [
  /api[_-]?key/i,
  /bearer\s+/i,
  /sk-[a-z0-9]{10,}/i,
  /cursor_[a-z0-9]+/i,
  /DATABASE_URL/i,
  /BINANCE_API_SECRET/i,
  /GROQ_API_KEY/i,
  /TELEGRAM_BOT_TOKEN/i,
];

const MAX_FIELD_LEN = 500;

export function redactSensitiveText(text: string): string {
  if (!text) return text;
  let out = text;
  for (const pattern of SECRET_DENYLIST) {
    out = out.replace(pattern, '[REDACTED]');
  }
  out = out.replace(/([a-zA-Z0-9+/=]{32,})/g, (match) => {
    if (match.length > 40) return '[REDACTED_TOKEN]';
    return match;
  });
  return out.slice(0, MAX_FIELD_LEN);
}

function sanitizeObject<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeObject(v)) as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeObject(v);
    }
    return out as T;
  }
  return value;
}

const ERROR_EVENT_PATTERN =
  /error|reject|fail|execution_blocked|protective_failed/i;

export async function getWeeklyTradeStatsIct(
  symbol: string,
  methodId: string
): Promise<WeeklyTradeStats> {
  const account = await prisma.testnetAccount.findFirst({
    where: { symbol, method_id: methodId },
    select: { id: true },
  });
  if (!account) {
    return { closedCount: 0, wins: 0, losses: 0, totalRealizedPnl: 0, totalFees: 0 };
  }

  const { weekStart } = getDayBoundsICT();
  const closed = await prisma.testnetPosition.findMany({
    where: {
      account_id: account.id,
      status: { in: ['closed', 'CLOSED'] },
      close_time: { gte: weekStart },
    },
    select: { realized_pnl: true, entry_fee: true, exit_fee: true, funding_fee: true },
  });

  let wins = 0;
  let losses = 0;
  let totalRealizedPnl = 0;
  let totalFees = 0;
  for (const p of closed) {
    const pnl = p.realized_pnl ?? 0;
    totalRealizedPnl += pnl;
    totalFees += (p.entry_fee ?? 0) + (p.exit_fee ?? 0) + (p.funding_fee ?? 0);
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
  }

  return { closedCount: closed.length, wins, losses, totalRealizedPnl, totalFees };
}

async function getLlmStatsWeekIct(): Promise<{ total: number; trades: number; noTrades: number }> {
  const { weekStart } = getDayBoundsICT();
  const decisions = await prisma.tradeDecision.findMany({
    where: { timestamp: { gte: weekStart }, method_id: 'kim_nghia' },
    select: { decision: true },
  });
  const trades = decisions.filter((d) => d.decision === 'trade').length;
  return { total: decisions.length, trades, noTrades: decisions.length - trades };
}

async function fetchRecentClosedPositions(
  symbol: string,
  methodId: string
): Promise<RecentClosedPositionRow[]> {
  const account = await prisma.testnetAccount.findFirst({
    where: { symbol, method_id: methodId },
    select: { id: true },
  });
  if (!account) return [];

  const { dayStart } = getDayBoundsICT();
  const rows = await prisma.testnetPosition.findMany({
    where: {
      account_id: account.id,
      status: { in: ['closed', 'CLOSED'] },
      close_time: { gte: dayStart },
    },
    orderBy: { close_time: 'desc' },
    take: 12,
    select: {
      position_id: true,
      side: true,
      entry_price: true,
      close_price: true,
      realized_pnl: true,
      close_reason: true,
      entry_time: true,
      close_time: true,
    },
  });

  return rows.map((r) => ({
    position_id: r.position_id,
    side: r.side,
    entry_price: r.entry_price,
    close_price: r.close_price ?? 0,
    realized_pnl: r.realized_pnl ?? 0,
    close_reason: redactSensitiveText(String(r.close_reason ?? '')),
    entry_time: r.entry_time.toISOString(),
    close_time: (r.close_time ?? r.entry_time).toISOString(),
  }));
}

async function fetchBinanceExposureSnapshot(symbol: string): Promise<BinanceExposureSnapshot> {
  try {
    const net = await fetchBinanceNetPosition(symbol);
    if (!net || Math.abs(net.positionAmt) < 1e-8) {
      return { available: true, side: 'flat', netQty: 0 };
    }
    const side = net.positionAmt > 0 ? 'long' : 'short';
    return {
      available: true,
      side,
      netQty: Math.abs(net.positionAmt),
      entryPrice: net.entryPrice,
      markPrice: net.markPrice,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      side: 'unknown',
      netQty: 0,
      note: redactSensitiveText(msg.slice(0, 200)),
    };
  }
}

async function fetchRecentDecisions(methodId: string): Promise<TradeDecisionRow[]> {
  const { dayStart } = getDayBoundsICT();
  const rows = await prisma.tradeDecision.findMany({
    where: { method_id: methodId, timestamp: { gte: dayStart } },
    orderBy: { timestamp: 'desc' },
    take: 20,
    select: {
      id: true,
      decision: true,
      grade: true,
      confidence: true,
      timeframe: true,
      reason: true,
      timestamp: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    decision: r.decision,
    grade: r.grade,
    confidence: r.confidence,
    timeframe: r.timeframe,
    reason: redactSensitiveText((r.reason || '').slice(0, MAX_FIELD_LEN)),
    timestamp: r.timestamp.toISOString(),
  }));
}

async function fetchRecentErrorEvents(): Promise<ErrorEventRow[]> {
  const events = await prisma.testnetTradeEvent.findMany({
    orderBy: { timestamp: 'desc' },
    take: 50,
  });

  return events
    .filter((e) => ERROR_EVENT_PATTERN.test(e.event_type))
    .slice(0, 15)
    .map((e) => ({
      event_type: e.event_type,
      timestamp: e.timestamp.toISOString(),
      summary: redactSensitiveText((e.event_data || e.event_type).slice(0, MAX_FIELD_LEN)),
    }));
}

const OPERATOR_NOTES: string[] = [
  'Số dư Telegram = ví Binance demo (nguồn đúng cho tiền thật trên sàn).',
  'Bot local = sổ ghi chép — có thể lệch với sàn nếu sync trễ vài phút.',
  'Lệnh khớp (fill) → bot mở vị thế qua WebSocket trong ~15 phút. Sau đó reconcile chỉ đóng sổ pending, KHÔNG mở lại lệnh cũ.',
  'Một symbol chỉ có tối đa 1 vị thế mở trong sổ local (ONE_WAY).',
  'openPositions + binanceExposure = trạng thái HIỆN TẠI. recentDecisions = lịch sử LLM, có thể đã hết hiệu lực.',
  'Giá entry lạ (vd short 62k) trong recentClosedPositions thường là lệnh limit CŨ đã khớp ngày trước — không phải giá thị trường hôm nay.',
  'Đóng sổ phantom (không có binance_order_id): PnL=0, không trừ ví. Lệnh có fill proof → sync PnL từ userTrades.',
];

export async function buildAiContext(scope: AiContextScope): Promise<AiContextBundle> {
  const { symbol, methodId } = getDefaultTradingScope();
  const includeCompare = scope === 'compare';

  const [
    account,
    todayTrades,
    weekTrades,
    health,
    llmStats,
    llmWeekStats,
    topNoTradeReasons,
    recentDecisions,
    recentErrors,
    openPositions,
    pendingOrders,
    binanceExposure,
    recentClosedPositions,
  ] = await Promise.all([
    getAccountBalanceSummary(symbol, methodId, true),
    getTodayTradeStatsIct(symbol, methodId),
    includeCompare ? getWeeklyTradeStatsIct(symbol, methodId) : Promise.resolve(undefined),
    getSystemHealthSnapshot(),
    getLlmStatsTodayIct(),
    includeCompare ? getLlmStatsWeekIct() : Promise.resolve(undefined),
    getTopNoTradeReasonsIct(5),
    fetchRecentDecisions(methodId),
    fetchRecentErrorEvents(),
    getOpenPositionLines(symbol, methodId),
    getPendingOrderLines(symbol, methodId),
    fetchBinanceExposureSnapshot(symbol),
    fetchRecentClosedPositions(symbol, methodId),
  ]);

  const bundle: AiContextBundle = {
    meta: {
      generatedAt: new Date().toISOString(),
      ictDate: getIctDateString(),
      symbol,
      methodId,
      scope,
    },
    account,
    todayTrades,
    weekTrades,
    health,
    llm: {
      stats: llmStats,
      weekStats: llmWeekStats,
      topNoTradeReasons,
    },
    recentDecisions,
    recentErrors,
    openPositions,
    pendingOrders,
    binanceExposure,
    recentClosedPositions,
    operatorNotes: OPERATOR_NOTES,
  };

  return sanitizeObject(bundle);
}

export function contextToJson(bundle: AiContextBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export interface ParsedAiCommand {
  action: 'analyze' | 'cancel';
  scope: AiContextScope;
  question?: string;
}

const REPORT_KEYWORD_SCOPES: Record<string, AiContextScope> = {
  'bao cao': 'today_run',
  baocao: 'today_run',
  'hom nay': 'today_run',
  homnay: 'today_run',
  loi: 'errors',
  lỗi: 'errors',
  pipeline: 'pipeline',
  llm: 'llm',
  'so sanh': 'compare',
  'so-sanh': 'compare',
};

export function parseAiCommandArgs(args: string): ParsedAiCommand {
  const trimmed = args.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return { action: 'analyze', scope: 'freeform' };
  }

  if (lower === 'cancel' || lower === 'huy') {
    return { action: 'cancel', scope: 'today_run' };
  }

  const reportScope = REPORT_KEYWORD_SCOPES[lower];
  if (reportScope) {
    return { action: 'analyze', scope: reportScope };
  }

  if (lower.startsWith('vi ') || lower.startsWith('vi\t')) {
    const question = trimmed.slice(3).trim();
    return { action: 'analyze', scope: 'freeform', question: question || undefined };
  }

  return { action: 'analyze', scope: 'freeform', question: trimmed };
}

export function splitMessageForTelegram(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
