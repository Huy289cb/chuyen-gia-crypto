import type React from 'react';

// ============================================
// Core Data Types
// ============================================

export interface PriceData {
  price: number;
  change24h: number;
  sparkline7d: number[];
  timestamp: string;
}

export interface KeyLevels {
  liquidity?: string;
  order_blocks?: string;
  fvg?: string;
  [key: string]: string | undefined;
}

export interface Prediction {
  timeframe: string;
  direction: 'up' | 'down' | 'sideways';
  confidence: number;
  target?: number;
  price_target?: number;
  invalidation_price?: number;
  reasoning?: string;
}

export interface Analysis {
  action: 'buy' | 'sell' | 'hold';
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  narrative?: string;
  timeframes?: Record<string, string>;
  key_levels?: KeyLevels;
  risk?: string;
  predictions?: Record<string, Prediction>;
  disclaimer?: string;
  suggested_entry?: number;
  stop_loss?: number;
  take_profit?: number;
  expected_rr?: number;
  invalidation_level?: number;
  reason_summary?: string;
  indicators?: {
    fibonacci?: {
      retracement?: Array<{ level: number; price: number; label: string }>;
      extension?: Array<{ level: number; price: number; label: string }>;
    };
    orderBlocks?: Array<{ type: 'bullish' | 'bearish'; high: number; low: number; timestamp: number }>;
    fairValueGaps?: Array<{ start: { time: number; price: number }; end: { time: number; price: number } }>;
    volume?: 'high' | 'low' | 'normal';
  };
}

export interface CryptoData {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  sparkline7d: number[];
  analysis?: Analysis;
  color: string;
}

export interface MarketData {
  btc?: PriceData;
  eth?: PriceData;
  timestamp: string;
}

// ============================================
// Trading Types
// ============================================

export interface TradingAccount {
  id: string;
  symbol: string;
  method_id?: string;
  equity: number;
  starting_balance: number;
  available_balance: number;
  realized_pnl: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  avg_r_multiple: number;
  consecutive_losses: number;
  cooldown_until?: string;
  created_at: string;
  updated_at: string;
}

export interface Position {
  id: string;
  account_id: string;
  symbol: string;
  side: 'long' | 'short';
  status: 'open' | 'closed' | 'stopped' | 'taken_profit' | 'closed_manual' | 'expired';
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  size_usd: number;
  size_qty: number;
  unrealized_pnl: number;
  realized_pnl: number | null;
  risk_percent: number;
  expected_rr: number;
  entry_time: string;
  close_time: string | null;
  close_reason: string | null;
  prediction_id: string | null;
}

export interface Trade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entry_price: number;
  exit_price?: number;
  close_price?: number;
  size_usd: number;
  realized_pnl: number;
  exit_reason?: string;
  close_reason?: string;
  opened_at?: string;
  entry_time?: string;
  closed_at?: string;
  close_time?: string;
  r_multiple: number;
}

export interface PendingOrder {
  id: string;
  order_id: string;
  account_id: number;
  symbol: string;
  side: 'long' | 'short';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  size_usd: number;
  size_qty: number;
  risk_usd: number;
  risk_percent: number;
  expected_rr: number;
  status: 'pending' | 'executed' | 'cancelled' | 'cancelled_manual' | 'cancelled_timeout' | 'cancelled_invalidation';
  created_at: string;
  executed_at?: string;
  linked_prediction_id?: number;
  invalidation_level?: number;
}

export interface PredictionHistory {
  id: string;
  analysis_id: number;
  timestamp: string;
  symbol: string;
  current_price: number;
  timeframe: string;
  direction: 'up' | 'down' | 'sideways';
  confidence: number;
  outcome: 'win' | 'loss' | 'neutral' | 'pending' | null;
  pnl: number | null;
  linked_position_id: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  reasoning?: string;
  narrative?: string;
  price_target?: number;
}

export interface PerformanceMetrics {
  symbol: string;
  starting_balance: number;
  current_equity: number;
  total_return_percent: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  avg_r_multiple: number;
  realized_pnl: number;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface TrendsData {
  prices: {
    btc: PriceData;
    eth: PriceData;
    marketData: MarketData;
    timestamp: string;
  };
  analysis: {
    btc: Analysis;
    eth: Analysis;
  };
  lastUpdated: string;
}

export interface PaperTradingData {
  accounts: TradingAccount[];
  positions: Position[];
  tradeHistory: Trade[];
}

// ============================================
// UI Types
// ============================================

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'info';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}
