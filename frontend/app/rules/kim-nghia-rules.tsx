'use client';

import { BookOpen, Target, Shield, Clock, TrendingUp, BarChart3, Layers, Activity } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

export function KimNghiaRules() {
  return (
    <div className="space-y-8">
      {/* Overview */}
      <section>
        <CardHeader 
          title="Kim Nghia Trading Method" 
          subtitle="SMC + Volume + Fibonacci Analysis"
          icon={<BookOpen className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <p className="text-foreground-secondary mb-4">
            Kim Nghia method combines Smart Money Concepts (SMC), Volume Analysis, and Fibonacci Retracement & Extension 
            for high-probability trade identification using multi-timeframe confluence.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="info">SMC</Badge>
            <Badge variant="success">Volume</Badge>
            <Badge variant="warning">Fibonacci</Badge>
            <Badge variant="default">Multi-Timeframe</Badge>
          </div>
        </Card>
      </section>

      {/* Multi-Timeframe Analysis */}
      <section>
        <CardHeader 
          title="Multi-Timeframe Analysis" 
          subtitle="H4 + H1 for direction, M15 for execution"
          icon={<Layers className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-accent-primary text-sm font-bold">H4</span>
              </div>
              <div>
                <h4 className="font-medium text-foreground">H4 - Bias & Trend</h4>
                <p className="text-sm text-foreground-secondary">Determine overall market direction and trend structure</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-accent-primary text-sm font-bold">H1</span>
              </div>
              <div>
                <h4 className="font-medium text-foreground">H1 - Confirmation</h4>
                <p className="text-sm text-foreground-secondary">Confirm trend direction and identify entry zones</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-accent-primary text-sm font-bold">M15</span>
              </div>
              <div>
                <h4 className="font-medium text-foreground">M15 - Execution</h4>
                <p className="text-sm text-foreground-secondary">Precise entry timing with stop loss placement</p>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* SMC Concepts */}
      <section>
        <CardHeader 
          title="Smart Money Concepts (SMC)" 
          subtitle="Order Blocks, FVG, Market Structure"
          icon={<Target className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-foreground mb-2">Order Blocks (OB)</h4>
              <p className="text-sm text-foreground-secondary">Last bullish/bearish candle before strong move - institutional order flow zones</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Fair Value Gaps (FVG)</h4>
              <p className="text-sm text-foreground-secondary">Imbalances where price moves quickly - often get filled</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Break of Structure (BOS)</h4>
              <p className="text-sm text-foreground-secondary">Price breaking previous swing high/low - trend continuation</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Change of Character (CHoCH)</h4>
              <p className="text-sm text-foreground-secondary">Trend reversal signal - structure shift</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Equal Highs/Lows (EQH/EQL)</h4>
              <p className="text-sm text-foreground-secondary">Liquidity zones where stops are placed</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Volume Analysis */}
      <section>
        <CardHeader 
          title="Volume Analysis" 
          subtitle="Confirm breakouts and reversals"
          icon={<Activity className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-foreground mb-2">Volume Expansion</h4>
              <p className="text-sm text-foreground-secondary">High volume confirms true breakouts</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Volume Contraction</h4>
              <p className="text-sm text-foreground-secondary">Low volume may indicate fakeouts or consolidation</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Volume at Key Zones</h4>
              <p className="text-sm text-foreground-secondary">Volume spike at S/R levels validates the zone</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Fibonacci Confluence */}
      <section>
        <CardHeader 
          title="Fibonacci Levels" 
          subtitle="Retracement for entry, Extension for TP"
          icon={<BarChart3 className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-foreground mb-2">Retracement Levels (Entry)</h4>
              <p className="text-sm text-foreground-secondary">38.2%, 50%, 61.8% - optimal entry zones after pullback</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Extension Levels (TP)</h4>
              <p className="text-sm text-foreground-secondary">127.2%, 161.8% - profit target zones</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Confluence</h4>
              <p className="text-sm text-foreground-secondary">Fibonacci + SMC + Volume = High probability setup</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Auto-Entry Criteria */}
      <section>
        <CardHeader 
          title="Auto-Entry Criteria" 
          subtitle="Method-specific entry rules"
          icon={<Shield className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span>
              <span className="text-sm text-foreground">Confidence ≥ 75%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span>
              <span className="text-sm text-foreground">Risk/Reward ≥ 2.5</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span>
              <span className="text-sm text-foreground">Multi-timeframe alignment (H4 + H1)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span>
              <span className="text-sm text-foreground">Volume confirmation</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span>
              <span className="text-sm text-foreground">Fibonacci confluence at entry</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span>
              <span className="text-sm text-foreground">SMC confirmation (OB/FVG/BOS)</span>
            </div>
          </div>
        </Card>
      </section>

      {/* Position Management */}
      <section>
        <CardHeader 
          title="Position Management" 
          subtitle="Active trade evaluation and decisions"
          icon={<TrendingUp className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-foreground mb-2">AI Position Analysis</h4>
              <p className="text-sm text-foreground-secondary">AI evaluates open positions every 15 minutes for closure recommendations</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Decision Options</h4>
              <p className="text-sm text-foreground-secondary">Hold, Close, Move SL, Partial TP, Scale in/out based on market conditions</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">Risk Management</h4>
              <p className="text-sm text-foreground-secondary">1% risk per trade with method-specific stop loss levels</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Configuration */}
      <section>
        <CardHeader 
          title="Method Configuration" 
          subtitle="Kim Nghia specific settings"
          icon={<Clock className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-foreground-secondary">Schedule</span>
              <p className="text-sm font-medium text-foreground">7m30s, 22m30s, 37m30s, 52m30s</p>
            </div>
            <div>
              <span className="text-xs text-foreground-secondary">Min Confidence</span>
              <p className="text-sm font-medium text-foreground">75%</p>
            </div>
            <div>
              <span className="text-xs text-foreground-secondary">Min R:R</span>
              <p className="text-sm font-medium text-foreground">2.5</p>
            </div>
            <div>
              <span className="text-xs text-foreground-secondary">Risk Per Trade</span>
              <p className="text-sm font-medium text-foreground">1%</p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
