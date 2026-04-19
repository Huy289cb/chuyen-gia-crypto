'use client';

import { BookOpen, Target, Shield, Clock, TrendingUp, BarChart3, Layers, Activity } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

interface KimNghiaRulesProps {
  language?: 'vi' | 'en';
}

const translations = {
  vi: {
    title: 'Phương Pháp Kim Nghia',
    subtitle: 'Phân tích SMC + Volume + Fibonacci',
    overview: 'Phương pháp Kim Nghia kết hợp Smart Money Concepts (SMC), Phân tích Volume, và Fibonacci Retracement & Extension để xác định giao dịch có xác suất cao sử dụng sự hội tụ đa khung thời gian.',
    badges: {
      smc: 'SMC',
      volume: 'Volume',
      fibonacci: 'Fibonacci',
      multiTimeframe: 'Đa khung thời gian'
    },
    multiTimeframe: {
      title: 'Phân Tích Đa Khung Thời Gian',
      subtitle: 'H4 + H1 để xác định xu hướng, M15 để thực hiện',
      h4: {
        title: 'H4 - Xu hướng',
        desc: 'Xác định hướng thị trường tổng thể và cấu trúc xu hướng'
      },
      h1: {
        title: 'H1 - Xác nhận',
        desc: 'Xác nhận hướng xu hướng và xác định vùng entry'
      },
      m15: {
        title: 'M15 - Thực hiện',
        desc: 'Thời điểm entry chính xác với đặt stop loss'
      }
    },
    smc: {
      title: 'Smart Money Concepts (SMC)',
      subtitle: 'Order Blocks, FVG, Cấu trúc thị trường'
    },
    volume: {
      title: 'Phân Tích Volume',
      subtitle: 'Volume mở rộng/thu hẹp, xác nhận breakout'
    },
    fibonacci: {
      title: 'Fibonacci',
      subtitle: 'Retracement zones (38.2%, 50%, 61.8%) và Extension (127.2%, 161.8%)'
    },
    breakout: {
      title: 'Breakout / Retest',
      subtitle: 'Xác nhận sức mạnh với volume, chờ retest sau breakout'
    },
    positionManagement: {
      title: 'Quản Lý Vị Thế',
      subtitle: 'Đánh giá và quyết định giao dịch đang hoạt động'
    },
    aiAnalysis: {
      title: 'Phân Tích Vị Thế AI',
      desc: 'AI đánh giá vị thế đang mở mỗi 15 phút để đưa ra khuyến nghị đóng'
    },
    decisionOptions: {
      title: 'Tùy Chọn Quyết Định',
      desc: 'Giữ nguyên, đóng một phần, hoặc đóng toàn bộ dựa trên phân tích AI'
    }
  },
  en: {
    title: 'Kim Nghia Trading Method',
    subtitle: 'SMC + Volume + Fibonacci Analysis',
    overview: 'Kim Nghia method combines Smart Money Concepts (SMC), Volume Analysis, and Fibonacci Retracement & Extension for high-probability trade identification using multi-timeframe confluence.',
    badges: {
      smc: 'SMC',
      volume: 'Volume',
      fibonacci: 'Fibonacci',
      multiTimeframe: 'Multi-Timeframe'
    },
    multiTimeframe: {
      title: 'Multi-Timeframe Analysis',
      subtitle: 'H4 + H1 for direction, M15 for execution',
      h4: {
        title: 'H4 - Bias & Trend',
        desc: 'Determine overall market direction and trend structure'
      },
      h1: {
        title: 'H1 - Confirmation',
        desc: 'Confirm trend direction and identify entry zones'
      },
      m15: {
        title: 'M15 - Execution',
        desc: 'Precise entry timing with stop loss placement'
      }
    },
    smc: {
      title: 'Smart Money Concepts (SMC)',
      subtitle: 'Order Blocks, FVG, Market Structure'
    },
    volume: {
      title: 'Volume Analysis',
      subtitle: 'Volume expansion/contraction, breakout confirmation'
    },
    fibonacci: {
      title: 'Fibonacci',
      subtitle: 'Retracement zones (38.2%, 50%, 61.8%) and Extension (127.2%, 161.8%)'
    },
    breakout: {
      title: 'Breakout / Retest',
      subtitle: 'Validate strength with volume, wait for retest after breakout'
    },
    positionManagement: {
      title: 'Position Management',
      subtitle: 'Active trade evaluation and decisions'
    },
    aiAnalysis: {
      title: 'AI Position Analysis',
      desc: 'AI evaluates open positions every 15 minutes for closure recommendations'
    },
    decisionOptions: {
      title: 'Decision Options',
      desc: 'Hold, partial close, or full close based on AI analysis'
    }
  }
};

export function KimNghiaRules({ language = 'en' }: KimNghiaRulesProps) {
  const t = translations[language];
  
  return (
    <div className="space-y-8">
      {/* Overview */}
      <section>
        <CardHeader 
          title={t.title} 
          subtitle={t.subtitle}
          icon={<BookOpen className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <p className="text-foreground-secondary mb-4">
            {t.overview}
          </p>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="info">{t.badges.smc}</Badge>
            <Badge variant="success">{t.badges.volume}</Badge>
            <Badge variant="warning">{t.badges.fibonacci}</Badge>
            <Badge variant="default">{t.badges.multiTimeframe}</Badge>
          </div>
        </Card>
      </section>

      {/* Multi-Timeframe Analysis */}
      <section>
        <CardHeader 
          title={t.multiTimeframe.title} 
          subtitle={t.multiTimeframe.subtitle}
          icon={<Layers className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-accent-primary text-sm font-bold">H4</span>
              </div>
              <div>
                <h4 className="font-medium text-foreground">{t.multiTimeframe.h4.title}</h4>
                <p className="text-sm text-foreground-secondary">{t.multiTimeframe.h4.desc}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-accent-primary text-sm font-bold">H1</span>
              </div>
              <div>
                <h4 className="font-medium text-foreground">{t.multiTimeframe.h1.title}</h4>
                <p className="text-sm text-foreground-secondary">{t.multiTimeframe.h1.desc}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-accent-primary text-sm font-bold">M15</span>
              </div>
              <div>
                <h4 className="font-medium text-foreground">{t.multiTimeframe.m15.title}</h4>
                <p className="text-sm text-foreground-secondary">{t.multiTimeframe.m15.desc}</p>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* SMC Concepts */}
      <section>
        <CardHeader 
          title={t.smc.title} 
          subtitle={t.smc.subtitle}
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
          title={t.volume.title} 
          subtitle={t.volume.subtitle}
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
          title={t.fibonacci.title} 
          subtitle={t.fibonacci.subtitle}
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
          title={t.positionManagement.title} 
          subtitle={t.positionManagement.subtitle}
          icon={<TrendingUp className="w-6 h-6" />}
        />
        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-foreground mb-2">{t.aiAnalysis.title}</h4>
              <p className="text-sm text-foreground-secondary">{t.aiAnalysis.desc}</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-2">{t.decisionOptions.title}</h4>
              <p className="text-sm text-foreground-secondary">{t.decisionOptions.desc}</p>
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
              <p className="text-sm font-medium text-foreground">62%</p>
            </div>
            <div>
              <span className="text-xs text-foreground-secondary">Min R:R</span>
              <p className="text-sm font-medium text-foreground">2.5</p>
            </div>
            <div>
              <span className="text-xs text-foreground-secondary">Risk Per Trade</span>
              <p className="text-sm font-medium text-foreground">10%</p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
