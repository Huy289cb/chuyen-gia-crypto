'use client';

import { BookOpen, Settings, Target, Shield, Clock, TrendingUp, AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <BookOpen className="w-8 h-8 text-accent-primary" />
            <h1 className="text-3xl font-bold text-foreground">System Rules & Behavior</h1>
          </div>
          <p className="text-foreground-secondary text-lg max-w-2xl mx-auto">
            Detailed explanation of paper trading system rules, behaviors, and decision logic
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Badge variant="info" size="sm">BTC Focus</Badge>
            <Badge variant="success" size="sm">ICT Methodology</Badge>
            <Badge variant="warning" size="sm">AI-Powered</Badge>
          </div>
        </div>

        {/* Auto-Entry Rules */}
        <section className="mb-12">
          <CardHeader 
            title="Auto-Entry Rules" 
            subtitle="When and how the system opens new positions"
            icon={<Target className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-6">
              <RuleCard
                title="1. Symbol Enablement"
                description="Only BTC trading is currently enabled (ETH temporarily disabled)"
                status="active"
                details="enabledSymbols: ['BTC'] - System rejects any ETH trading attempts"
              />
              <RuleCard
                title="2. Confidence Threshold"
                description="AI confidence must be >= 80% to consider entry"
                status="active"
                details="MIN_CONFIDENCE_THRESHOLD: 80 - Lower confidence signals are ignored"
              />
              <RuleCard
                title="3. Clear Market Bias"
                description="Analysis must show bullish or bearish bias (not neutral)"
                status="active"
                details="Neutral bias results in HOLD action - no positions opened"
              />
              <RuleCard
                title="4. Multi-Timeframe Alignment"
                description="Majority of 1h and 4h timeframes must align with bias"
                status="active"
                details="requiredTimeframes: ['1h', '4h'] - 1h is primary, 4h secondary"
              />
              <RuleCard
                title="5. Risk/Reward Ratio"
                description="Expected R:R must be at least 1:2"
                status="active"
                details="MIN_RR_RATIO: 2.0 - Lower R:R setups are rejected"
              />
              <RuleCard
                title="6. Account Cooldown"
                description="No entries during cooldown period"
                status="active"
                details="4-hour cooldown after 3 consecutive losses"
              />
              <RuleCard
                title="7. Position Limit"
                description="Maximum 8 concurrent BTC positions"
                status="active"
                details="MAX_POSITIONS_PER_SYMBOL: 8 - New positions rejected if limit reached"
              />
              <RuleCard
                title="8. Trading Sessions"
                description="Only trade during high-liquidity sessions"
                status="active"
                details="London (07:00-10:00 UTC) and NY Killzone (12:00-15:00 UTC)"
              />
            </div>
          </Card>
        </section>

        {/* Order Types */}
        <section className="mb-12">
          <CardHeader 
            title="Order Types & Execution" 
            subtitle="How different order types are handled"
            icon={<Settings className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-6">
              <OrderTypeCard
                type="Market Orders"
                condition="Entry price within 0.5% of current price"
                action="Execute immediately at current price"
                example="Current: $71,000, Suggested: $71,200 (0.28% away) -> Market Order"
              />
              <OrderTypeCard
                type="Limit Orders"
                condition="Entry price more than 0.5% away from current price"
                action="Create pending order, wait for price to hit entry"
                example="Current: $71,000, Suggested: $67,000 (5.6% away) -> Limit Order"
              />
              <OrderTypeCard
                type="Limit Order Execution"
                condition="Price hits entry level during 30-second updates"
                action="Convert to market position with original SL/TP"
                example="BTC drops to $67,000 -> Limit order executed as long position"
              />
            </div>
          </Card>
        </section>

        {/* Position Management */}
        <section className="mb-12">
          <CardHeader 
            title="Position Management Rules" 
            subtitle="How open positions are monitored and managed"
            icon={<Shield className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-6">
              <RuleCard
                title="Stop Loss & Take Profit"
                description="Automatic monitoring every 30 seconds"
                status="active"
                details="Positions closed when SL or TP levels are hit"
              />
              <RuleCard
                title="Early Position Closure"
                description="AI can recommend early closure on prediction reversal"
                status="active"
                details="New analysis with opposite bias + >80% confidence triggers closure review"
              />
              <RuleCard
                title="AI Position Analysis"
                description="AI evaluates all open positions every 15 minutes"
                status="active"
                details="Recommends close/hold/adjust with >80% confidence threshold"
              />
              <RuleCard
                title="Risk Management"
                description="1% risk per trade with position sizing"
                status="active"
                details="RISK_PER_TRADE_PERCENT: 1 - Fixed 1% account risk per position"
              />
            </div>
          </Card>
        </section>

        {/* Limit Order Management */}
        <section className="mb-12">
          <CardHeader 
            title="Limit Order Management" 
            subtitle="How pending limit orders are monitored and managed"
            icon={<Clock className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-6">
              <RuleCard
                title="Price Monitoring"
                description="Pending orders checked every 30 seconds"
                status="active"
                details="System monitors if price hits entry level for execution"
              />
              <RuleCard
                title="AI Limit Order Analysis"
                description="AI evaluates pending orders every 15 minutes"
                status="active"
                details="Recommends keep/cancel/modify based on market conditions"
              />
              <RuleCard
                title="Manual Cancellation"
                description="Users can cancel pending orders via UI"
                status="active"
                details="Pending Orders section provides manual cancellation controls"
              />
              <RuleCard
                title="Order Validation"
                description="Entry prices validated to be realistic"
                status="active"
                details="Entry must be within 10% of current price when order created"
              />
            </div>
          </Card>
        </section>

        {/* Performance & Cooldown */}
        <section className="mb-12">
          <CardHeader 
            title="Performance & Risk Controls" 
            subtitle="System protections and performance tracking"
            icon={<TrendingUp className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-6">
              <RuleCard
                title="Consecutive Loss Protection"
                description="4-hour cooldown after 3 consecutive losses"
                status="active"
                details="MAX_CONSECUTIVE_LOSSES: 3, COOLDOWN_HOURS: 4"
              />
              <RuleCard
                title="Performance Tracking"
                description="Comprehensive metrics calculation"
                status="active"
                details="Win rate, profit factor, drawdown, R multiple tracking"
              />
              <RuleCard
                title="Account Separation"
                description="Independent accounts for BTC and ETH"
                status="active"
                details="100 USDT starting balance per symbol, separate tracking"
              />
              <RuleCard
                title="Trade History"
                description="Complete trade logging with pagination"
                status="active"
                details="10 trades per page, BTC-only filtering, detailed outcomes"
              />
            </div>
          </Card>
        </section>

        {/* Important Notes */}
        <section className="mb-12">
          <CardHeader 
            title="Important System Notes" 
            subtitle="Critical information about system behavior"
            icon={<AlertTriangle className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-4">
              <NoteCard
                type="warning"
                title="Paper Trading Only"
                description="This is a simulation system. No real money is involved."
              />
              <NoteCard
                type="info"
                title="Educational Purpose"
                description="Designed for learning and evaluating AI performance, not financial advice."
              />
              <NoteCard
                type="warning"
                title="API Limitations"
                description="Analysis runs every 15 minutes due to free Groq API limits."
              />
              <NoteCard
                type="info"
                title="Data Freshness"
                description="Price updates every 30 seconds for position monitoring."
              />
              <NoteCard
                type="warning"
                title="ETH Trading Disabled"
                description="ETH trading temporarily disabled to focus on BTC performance improvement."
              />
            </div>
          </Card>
        </section>

        {/* Configuration Summary */}
        <section className="mb-12">
          <CardHeader 
            title="Configuration Summary" 
            subtitle="Current system configuration values"
            icon={<Settings className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ConfigSection title="Trading Settings">
                <ConfigItem label="Risk Per Trade" value="1%" />
                <ConfigItem label="Min Confidence" value="80%" />
                <ConfigItem label="Min R:R Ratio" value="2.0" />
                <ConfigItem label="Max Positions" value="8 BTC" />
                <ConfigItem label="Enabled Symbols" value="BTC only" />
              </ConfigSection>
              <ConfigSection title="System Settings">
                <ConfigItem label="Price Updates" value="30 seconds" />
                <ConfigItem label="AI Analysis" value="15 minutes" />
                <ConfigItem label="Cooldown Duration" value="4 hours" />
                <ConfigItem label="Max Consecutive Losses" value="3" />
                <ConfigItem label="Timeframe Priority" value="1h primary, 4h secondary" />
              </ConfigSection>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

function RuleCard({ title, description, status, details }: {
  title: string;
  description: string;
  status: 'active' | 'inactive' | 'conditional';
  details: string;
}) {
  const StatusIcon = status === 'active' ? CheckCircle : status === 'inactive' ? XCircle : AlertTriangle;
  const statusColor = status === 'active' ? 'text-success' : status === 'inactive' ? 'text-danger' : 'text-warning';
  
  return (
    <div className="border border-border-subtle rounded-lg p-4 bg-surface-1/50">
      <div className="flex items-start gap-3">
        <StatusIcon className={`w-5 h-5 ${statusColor} mt-0.5 flex-shrink-0`} />
        <div className="flex-1">
          <h3 className="font-semibold text-foreground mb-1">{title}</h3>
          <p className="text-foreground-secondary text-sm mb-2">{description}</p>
          <p className="text-foreground-tertiary text-xs font-mono bg-surface-1 rounded px-2 py-1">
            {details}
          </p>
        </div>
      </div>
    </div>
  );
}

function OrderTypeCard({ type, condition, action, example }: {
  type: string;
  condition: string;
  action: string;
  example: string;
}) {
  return (
    <div className="border border-border-subtle rounded-lg p-4 bg-surface-1/50">
      <h3 className="font-semibold text-foreground mb-3">{type}</h3>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <div className="w-2 h-2 bg-accent-primary rounded-full mt-1.5 flex-shrink-0" />
          <div>
            <p className="text-foreground-secondary text-sm font-medium">Condition:</p>
            <p className="text-foreground text-sm">{condition}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-2 h-2 bg-success rounded-full mt-1.5 flex-shrink-0" />
          <div>
            <p className="text-foreground-secondary text-sm font-medium">Action:</p>
            <p className="text-foreground text-sm">{action}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-2 h-2 bg-info rounded-full mt-1.5 flex-shrink-0" />
          <div>
            <p className="text-foreground-secondary text-sm font-medium">Example:</p>
            <p className="text-foreground text-sm">{example}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoteCard({ type, title, description }: {
  type: 'warning' | 'info' | 'success' | 'danger';
  title: string;
  description: string;
}) {
  const colors = {
    warning: 'bg-warning-dim text-warning border-warning/20',
    info: 'bg-info-dim text-info border-info/20',
    success: 'bg-success-dim text-success border-success/20',
    danger: 'bg-danger-dim text-danger border-danger/20'
  };
  
  const Icon = type === 'warning' ? AlertTriangle : type === 'info' ? Info : type === 'success' ? CheckCircle : XCircle;
  
  return (
    <div className={`border rounded-lg p-4 ${colors[type]}`}>
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-semibold mb-1">{title}</h4>
          <p className="text-sm">{description}</p>
        </div>
      </div>
    </div>
  );
}

function ConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold text-foreground mb-3">{title}</h3>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border-subtle">
      <span className="text-foreground-secondary text-sm">{label}</span>
      <span className="text-foreground font-mono text-sm font-medium">{value}</span>
    </div>
  );
}
