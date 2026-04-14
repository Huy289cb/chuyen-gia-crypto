'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, Target, Layers, Zap, Shield } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { cn, formatPrice } from '@/lib/utils';
import type { PriceData, Analysis, KeyLevels } from '@/app/types';

interface CryptoCardProps {
  name: string;
  symbol: string;
  data?: PriceData;
  analysis?: Analysis;
  color: string;
}

const actionConfig = {
  buy: { 
    color: 'text-success', 
    bg: 'bg-success-dim',
    border: 'border-success/20',
    text: 'BUY',
    icon: TrendingUp,
  },
  sell: { 
    color: 'text-danger', 
    bg: 'bg-danger-dim',
    border: 'border-danger/20',
    text: 'SELL',
    icon: TrendingDown,
  },
  hold: { 
    color: 'text-warning', 
    bg: 'bg-warning-dim',
    border: 'border-warning/20',
    text: 'HOLD',
    icon: Minus,
  },
};

const biasConfig = {
  bullish: { color: 'text-success', bg: 'bg-success-dim', text: 'BULLISH' },
  bearish: { color: 'text-danger', bg: 'bg-danger-dim', text: 'BEARISH' },
  neutral: { color: 'text-foreground-tertiary', bg: 'bg-surface-2', text: 'NEUTRAL' },
};

export function CryptoCard({ name, symbol, data, analysis, color }: CryptoCardProps) {
  const price = data?.price || 0;
  const change24h = data?.change24h || 0;
  const sparkline = data?.sparkline7d || [];
  
  const action = analysis?.action || 'hold';
  const bias = analysis?.bias || 'neutral';
  const confidence = analysis?.confidence || 0;
  const narrative = analysis?.narrative;
  const timeframes = analysis?.timeframes;
  const keyLevels = analysis?.key_levels;
  const riskNotes = analysis?.risk;
  
  const actionCfg = actionConfig[action];
  const biasCfg = biasConfig[bias];
  const ActionIcon = actionCfg.icon;
  const isPositive = change24h >= 0;

  // Mini sparkline (last 20 points)
  const miniSparkline = sparkline.slice(-20);
  const sparklineTrend = miniSparkline.length > 1 
    ? miniSparkline[miniSparkline.length - 1] - miniSparkline[0]
    : 0;

  return (
    <Card className="h-full" padding="lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center text-bg-primary font-bold text-lg"
            style={{ backgroundColor: color }}
          >
            {symbol}
          </div>
          <div>
            <h3 className="font-bold text-lg text-foreground">{name}</h3>
            <p className="text-sm text-foreground-tertiary">{symbol}/USD</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={action === 'buy' ? 'success' : action === 'sell' ? 'danger' : 'warning'}>
            {actionCfg.text}
          </Badge>
          <Badge variant={bias === 'bullish' ? 'success' : bias === 'bearish' ? 'danger' : 'neutral'} size="sm">
            {biasCfg.text}
          </Badge>
        </div>
      </div>

      {/* Price */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-foreground font-mono">
            ${formatPrice(price)}
          </span>
        </div>
        <div className={cn('flex items-center gap-1 mt-1', isPositive ? 'text-success' : 'text-danger')}>
          {isPositive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          <span className="font-semibold font-mono">{Math.abs(change24h).toFixed(2)}%</span>
          <span className="text-foreground-tertiary text-sm ml-1">(24h)</span>
        </div>
      </div>

      {/* Sparkline */}
      {miniSparkline.length > 1 && (
        <div className="mb-4 h-12">
          <Sparkline data={miniSparkline} positive={sparklineTrend >= 0} />
        </div>
      )}

      {/* ICT Analysis */}
      <div className={cn('p-4 rounded-lg border', actionCfg.bg, actionCfg.border)}>
        <div className="flex items-center gap-2 mb-3">
          <ActionIcon size={18} className={actionCfg.color} />
          <span className={cn('font-semibold', actionCfg.color)}>ICT Smart Money Analysis</span>
        </div>
        
        {/* Narrative */}
        {narrative && (
          <div className={cn('p-3 rounded-lg mb-3', biasCfg.bg)}>
            <div className="flex items-center gap-2 mb-2">
              <div className={cn('w-2 h-2 rounded-full', biasCfg.color?.replace('text-', 'bg-') || 'bg-foreground-tertiary')} />
              <span className={cn('text-xs font-bold uppercase', biasCfg.color)}>
                {biasCfg.text} BIAS
              </span>
            </div>
            <p className="text-sm text-foreground-secondary leading-relaxed">{narrative}</p>
          </div>
        )}
        
        {/* Confidence Bar */}
        <ConfidenceBar confidence={confidence} colorClass={actionCfg.color} />
        
        {/* Timeframe Structure */}
        {timeframes && <TimeframeStructure timeframes={timeframes} />}
        
        {/* Key Levels */}
        {keyLevels && <KeyLevelsSection keyLevels={keyLevels} />}
      </div>

      {/* Risk Note */}
      {riskNotes && (
        <div className="flex items-start gap-2 mt-3 text-xs text-foreground-tertiary bg-surface-1 p-3 rounded-lg">
          <Shield size={14} className="mt-0.5 flex-shrink-0 text-warning" />
          <span>{riskNotes}</span>
        </div>
      )}
    </Card>
  );
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 40 - ((val - min) / range) * 40;
    return `${x},${y}`;
  });
  
  const pathD = `M 0,${40 - ((data[0] - min) / range) * 40} L ${points.join(' ')}`;
  const fillD = `${pathD} L 100,40 L 0,40 Z`;
  
  const strokeColor = positive ? 'var(--success)' : 'var(--danger)';
  const fillColor = positive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';

  return (
    <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
      <path d={fillD} fill={fillColor} stroke="none" />
      <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ConfidenceBar({ confidence, colorClass }: { confidence: number; colorClass: string }) {
  const percentage = Math.round(confidence * 100);
  
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-foreground-tertiary">ICT Confidence</span>
        <span className="font-semibold text-foreground font-mono">{percentage}%</span>
      </div>
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
        <div 
          className={cn('h-full transition-all duration-500 rounded-full', colorClass?.replace('text-', 'bg-') || 'bg-accent-primary')}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function TimeframeStructure({ timeframes }: { timeframes: Record<string, string> }) {
  const tfOrder = ['1d', '4h', '1h'];
  const tfLabels: Record<string, string> = { '1d': '1D', '4h': '4H', '1h': '1H' };
  
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-semibold text-foreground-tertiary uppercase tracking-wide">Multi-Timeframe Structure</p>
      {tfOrder.map(tf => {
        const desc = timeframes[tf];
        if (!desc) return null;
        
        const isBullish = desc.toLowerCase().includes('bullish') || desc.toLowerCase().includes('bos');
        const isBearish = desc.toLowerCase().includes('bearish') || desc.toLowerCase().includes('choch');
        const colorClass = isBullish ? 'text-success bg-success-dim' : 
                          isBearish ? 'text-danger bg-danger-dim' : 
                          'text-foreground-secondary bg-surface-1';
        
        return (
          <div key={tf} className={cn('flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg', colorClass)}>
            <span className="font-bold w-6 font-mono">{tfLabels[tf]}</span>
            <span className="flex-1 truncate">{desc}</span>
          </div>
        );
      })}
    </div>
  );
}

function KeyLevelsSection({ keyLevels }: { keyLevels: KeyLevels }) {
  const [expanded, setExpanded] = useState(false);
  
  const sections = [
    { key: 'liquidity', icon: Target, label: 'Liquidity', color: 'text-info' },
    { key: 'order_blocks', icon: Layers, label: 'Order Blocks', color: 'text-accent-primary' },
    { key: 'fvg', icon: Zap, label: 'FVG', color: 'text-warning' }
  ];
  
  const hasAny = sections.some(({ key }) => keyLevels[key] && keyLevels[key] !== 'not identified');
  if (!hasAny) return null;
  
  return (
    <div className="mt-3 border-t border-border-default pt-3">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-xs font-semibold text-foreground-tertiary uppercase tracking-wide hover:text-foreground transition-colors"
      >
        <span>Key Levels (ICT)</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-2">
          {sections.map(({ key, icon: Icon, label, color }) => {
            const value = keyLevels[key];
            if (!value || value === 'not identified') return null;
            
            return (
              <div key={key} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-surface-1">
                <Icon size={14} className={cn('mt-0.5', color)} />
                <div>
                  <span className={cn('font-semibold', color)}>{label}:</span>
                  <span className="text-foreground-secondary ml-1">{value}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
