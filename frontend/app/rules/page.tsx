'use client';

import { useState, useEffect, Suspense } from 'react';
import { BookOpen, Settings, Target, Shield, Clock, TrendingUp, AlertTriangle, CheckCircle, XCircle, Info, Globe, ArrowLeft } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useSearchParams } from 'next/navigation';
import { KimNghiaRules } from './kim-nghia-rules';

type Language = 'vi' | 'en';
type Method = 'ict' | 'kim_nghia';

const translations = {
  vi: {
    title: 'Quy Tắc & Hành Vi Hệ Thống',
    subtitle: 'Giải thích chi tiết về quy tắc, hành vi và logic quyết định của hệ thống paper trading',
    badges: {
      btcFocus: 'Tập trung BTC',
      ictMethodology: 'Phương pháp ICT',
      aiPowered: 'Hỗ trợ AI'
    },
    sections: {
      autoEntry: {
        title: 'Quy Tắc Tự Động Vào Lệnh',
        subtitle: 'Khi và cách hệ thống mở vị thế mới'
      },
      orderTypes: {
        title: 'Loại Lệnh & Thực Thi',
        subtitle: 'Cách xử lý các loại lệnh khác nhau'
      },
      positionManagement: {
        title: 'Quy Tắc Quản Lý Vị Thế',
        subtitle: 'Cách theo dõi và quản lý vị thế đang mở'
      },
      limitOrderManagement: {
        title: 'Quản Lý Lệnh Chờ',
        subtitle: 'Cách theo dõi và quản lý lệnh chờ'
      },
      performanceRisk: {
        title: 'Hiệu Suất & Kiểm Soát Rủi Ro',
        subtitle: 'Bảo vệ hệ thống và theo dõi hiệu suất'
      },
      importantNotes: {
        title: 'Lưu Ý Quan Trọng Hệ Thống',
        subtitle: 'Thông tin quan trọng về hành vi hệ thống'
      },
      configuration: {
        title: 'Tóm Tắt Cấu Hình',
        subtitle: 'Giá trị cấu hình hệ thống hiện tại'
      }
    },
    rules: {
      symbolEnablement: {
        title: '1. Kích Hoạt Ký Hiệu',
        description: 'Chỉ giao dịch BTC được kích hoạt (ETH tạm thời vô hiệu hóa)',
        details: 'enabledSymbols: [\'BTC\'] - Hệ thống từ chối mọi nỗ lực giao dịch ETH'
      },
      confidenceThreshold: {
        title: '2. Ngưỡng Tự Tin',
        description: 'Tự tin của AI phải >= 70% để xem xét vào lệnh',
        details: 'MIN_CONFIDENCE_THRESHOLD: 70 - Tín hiệu tự tin thấp hơn bị bỏ qua'
      },
      clearBias: {
        title: '3. Thiên Hướng Thị Trường Rõ Ràng',
        description: 'Phân tích phải hiển thị thiên hướng tăng hoặc giảm (không phải trung lập)',
        details: 'Thiên hướng trung lập dẫn đến hành động HOLD - không mở vị thế'
      },
      multiTimeframe: {
        title: '4. Căn H chỉnh Đa Khung Thời Gian',
        description: 'Đa số các khung thời gian 1h và 4h phải căn chỉnh với thiên hướng',
        details: 'requiredTimeframes: [\'1h\', \'4h\'] - 1h chính, 4h phụ'
      },
      riskReward: {
        title: '5. Tỷ Lệ Rủi Ro/Phần Thưởng',
        description: 'R:R kỳ vọng phải ít nhất 1:2',
        details: 'MIN_RR_RATIO: 2.0 - Thiết lập R:R thấp hơn bị từ chối'
      },
      cooldown: {
        title: '6. Giai Đoạn Nghỉ Tài Khoản',
        description: 'Không vào lệnh trong giai đoạn nghỉ',
        details: 'Nghỉ 4 giờ sau 8 lỗ liên tiếp'
      },
      positionLimit: {
        title: '7. Giới Hạn Vị Thế',
        description: 'Tối đa 6 vị thế đồng thởi mỗi ký hiệu',
        details: 'MAX_POSITIONS_PER_SYMBOL: 6 - Từ chối vị thế mới nếu đạt giới hạn'
      },
      tradingSessions: {
        title: '8. Phiên Giao Dịch',
        description: 'Giao dịch trong tất cả mọi khung giờ',
        details: '24/7 giao dịch được kích hoạt - không giới hạn phiên'
      }
    },
    orderTypes: {
      marketOrders: {
        title: 'Lệnh Thị Trường',
        condition: 'Giá vào lệnh trong 0.5% giá thị trường hiện tại',
        action: 'Thực thi ngay lập tức tại giá hiện tại',
        example: 'Hiện tại: $71,000, Gợi ý: $71,200 (0.28% away) -> Lệnh thị trường'
      },
      limitOrders: {
        title: 'Lệnh Chờ',
        condition: 'Giá vào lệnh cách giá thị trường hiện tại hơn 0.5%',
        action: 'Tạo lệnh chờ, đợi giá chạm mức vào lệnh',
        example: 'Hiện tại: $71,000, Gợi ý: $67,000 (5.6% away) -> Lệnh chờ'
      },
      limitExecution: {
        title: 'Thực Thi Lệnh Chờ',
        condition: 'Giá chạm mức vào lệnh trong cập nhật 30 giây',
        action: 'Chuyển thành vị thế thị trường với SL/TP gốc',
        example: 'BTC giảm xuống $67,000 -> Lệnh chờ thực thi như vị thế dài'
      }
    },
    positionManagement: {
      stopLoss: {
        title: 'Stop Loss & Take Profit',
        description: 'Theo dõi tự động mỗi 30 giây',
        details: 'Vị thế đóng khi chạm mức SL hoặc TP'
      },
      earlyClosure: {
        title: 'Đóng Vị Thế Sớm',
        description: 'AI có thể đề xuất đóng sớm khi dự đoán đảo chiều',
        status: 'active',
        details: 'Phân tích mới với thiên hướng đối lập + >80% tự tin kích hoạt xem xét đóng'
      },
      aiAnalysis: {
        title: 'Phân Tích Vị Thế AI',
        description: 'AI đánh giá tất cả vị thế đang mở mỗi 15 phút',
        status: 'active',
        details: 'Đề xuất đóng/giữ/điều chỉnh với ngưỡng tự tin >80%'
      },
      riskManagement: {
        title: 'Quản Lý Rủi Ro',
        description: '10% rủi ro mỗi lệnh với tính toán kích thước vị thế',
        status: 'active',
        details: 'RISK_PER_TRADE_PERCENT: 10 - 10% rủi ro tài khoản cố định mỗi vị thế'
      }
    },
    limitOrderManagement: {
      priceMonitoring: {
        title: 'Theo Dõi Giá',
        description: 'Lệnh chờ được kiểm tra mỗi 30 giây',
        status: 'active',
        details: 'Hệ thống theo dõi nếu giá chạm mức vào lệnh để thực thi'
      },
      aiAnalysis: {
        title: 'Phân Tích Lệnh Chờ AI',
        description: 'AI đánh giá lệnh chờ mỗi 15 phút',
        status: 'active',
        details: 'Đề xuất giữ/hủy/chỉnh sửa dựa trên điều kiện thị trường'
      },
      manualCancellation: {
        title: 'Hủy Thủ Công',
        description: 'Người dùng có thể hủy lệnh chờ qua UI',
        status: 'active',
        details: 'Phần Lệnh Chờ cung cấp điều khiển hủy thủ công'
      },
      orderValidation: {
        title: 'Xác Thực Lệnh',
        description: 'Giá vào lệnh được xác thực để thực tế',
        status: 'active',
        details: 'Giá vào lệnh phải trong 10% giá hiện tại khi tạo lệnh'
      }
    },
    performanceRisk: {
      consecutiveLosses: {
        title: 'Bảo Vệ Lỗ Liên Tiếp',
        description: 'Nghỉ 4 giờ sau 8 lỗ liên tiếp',
        status: 'active',
        details: 'MAX_CONSECUTIVE_LOSSES: 8, COOLDOWN_HOURS: 4'
      },
      performanceTracking: {
        title: 'Theo Dõi Hiệu Suất',
        description: 'Tính toán chỉ số toàn diện',
        status: 'active',
        details: 'Tỷ lệ thắng, hệ số lợi nhuận, drawdown, R multiple theo dõi'
      },
      accountSeparation: {
        title: 'Phân Tách Tài Khoản',
        description: 'Tài khoản độc lập cho BTC và ETH',
        status: 'active',
        details: '100 USDT ban đầu mỗi ký hiệu, theo dõi riêng biệt'
      },
      tradeHistory: {
        title: 'Lịch Sử Giao Dịch',
        description: 'Ghi nhật ký giao dịch hoàn chỉnh với phân trang',
        status: 'active',
        details: '10 giao dịch mỗi trang, lọc chỉ BTC, kết quả chi tiết'
      }
    },
    importantNotes: {
      paperTrading: {
        title: 'Chỉ Paper Trading',
        description: 'Đây là hệ thống mô phỏng. Không có tiền thật liên quan.'
      },
      educational: {
        title: 'Mục Đích Giáo Dục',
        description: 'Thiết kế để học và đánh giá hiệu suất AI, không phải tư vấn tài chính.'
      },
      apiLimitations: {
        title: 'Giới Hạn API',
        description: 'Phân tích chạy mỗi 15 phút do giới hạn API Groq miễn phí.'
      },
      dataFreshness: {
        title: 'Tính Mới Dữ Liệu',
        description: 'Cập nhật giá mỗi 30 giây để theo dõi vị thế.'
      },
      ethDisabled: {
        title: 'Giao Dịch ETH Bị Vô Hiệu Hóa',
        description: 'Giao dịch ETH tạm thời vô hiệu hóa để tập trung cải thiện hiệu suất BTC.'
      }
    },
    tradingSettings: {
      title: 'Thiết Lập Giao Dịch',
      riskPerTrade: '10%',
      minConfidence: '70%',
      minRR: '2.0',
      maxPositions: '6 mỗi ký hiệu',
      enabledSymbols: 'Chỉ BTC',
      timeframes: '1h chính, 4h phụ'
    },
    systemSettings: {
      title: 'Thiết Lập Hệ Thống',
      priceUpdates: '30 giây',
      aiAnalysis: '15 phút',
      cooldownDuration: '4 giờ',
      maxConsecutiveLosses: '8',
      timeframePriority: '1h chính, 4h phụ'
    }
  },
  en: {
    title: 'System Rules & Behavior',
    subtitle: 'Detailed explanation of paper trading system rules, behaviors, and decision logic',
    badges: {
      btcFocus: 'BTC Focus',
      ictMethodology: 'ICT Methodology',
      aiPowered: 'AI-Powered'
    },
    sections: {
      autoEntry: {
        title: 'Auto-Entry Rules',
        subtitle: 'When and how the system opens new positions'
      },
      orderTypes: {
        title: 'Order Types & Execution',
        subtitle: 'How different order types are handled'
      },
      positionManagement: {
        title: 'Position Management Rules',
        subtitle: 'How open positions are monitored and managed'
      },
      limitOrderManagement: {
        title: 'Limit Order Management',
        subtitle: 'How pending limit orders are monitored and managed'
      },
      performanceRisk: {
        title: 'Performance & Risk Controls',
        subtitle: 'System protections and performance tracking'
      },
      importantNotes: {
        title: 'Important System Notes',
        subtitle: 'Critical information about system behavior'
      },
      configuration: {
        title: 'Configuration Summary',
        subtitle: 'Current system configuration values'
      }
    },
    rules: {
      symbolEnablement: {
        title: '1. Symbol Enablement',
        description: 'Only BTC trading is currently enabled (ETH temporarily disabled)',
        details: 'enabledSymbols: [\'BTC\'] - System rejects any ETH trading attempts'
      },
      confidenceThreshold: {
        title: '2. Confidence Threshold',
        description: 'AI confidence must be >= 70% to consider entry',
        details: 'MIN_CONFIDENCE_THRESHOLD: 70 - Lower confidence signals are ignored'
      },
      clearBias: {
        title: '3. Clear Market Bias',
        description: 'Analysis must show bullish or bearish bias (not neutral)',
        details: 'Neutral bias results in HOLD action - no positions opened'
      },
      multiTimeframe: {
        title: '4. Multi-Timeframe Alignment',
        description: 'Majority of 1h and 4h timeframes must align with bias',
        details: 'requiredTimeframes: [\'1h\', \'4h\'] - 1h primary, 4h secondary'
      },
      riskReward: {
        title: '5. Risk/Reward Ratio',
        description: 'Expected R:R must be at least 1:2',
        details: 'MIN_RR_RATIO: 2.0 - Lower R:R setups are rejected'
      },
      cooldown: {
        title: '6. Account Cooldown',
        description: 'No entries during cooldown period',
        details: '4-hour cooldown after 8 consecutive losses'
      },
      positionLimit: {
        title: '7. Position Limit',
        description: 'Maximum 6 concurrent positions per symbol',
        details: 'MAX_POSITIONS_PER_SYMBOL: 6 - New positions rejected if limit reached'
      },
      tradingSessions: {
        title: '8. Trading Sessions',
        description: 'Trade during all timeframes',
        details: '24/7 trading enabled - no session restrictions'
      }
    },
    orderTypes: {
      marketOrders: {
        title: 'Market Orders',
        condition: 'Entry price within 0.5% of current market price',
        action: 'Execute immediately at current price',
        example: 'Current: $71,000, Suggested: $71,200 (0.28% away) -> Market Order'
      },
      limitOrders: {
        title: 'Limit Orders',
        condition: 'Entry price more than 0.5% away from current price',
        action: 'Create pending order, wait for price to hit entry',
        example: 'Current: $71,000, Suggested: $67,000 (5.6% away) -> Limit Order'
      },
      limitExecution: {
        title: 'Limit Order Execution',
        condition: 'Price hits entry level during 30-second updates',
        action: 'Convert to market position with original SL/TP',
        example: 'BTC drops to $67,000 -> Limit order executed as long position'
      }
    },
    positionManagement: {
      stopLoss: {
        title: 'Stop Loss & Take Profit',
        description: 'Automatic monitoring every 30 seconds',
        details: 'Positions closed when SL or TP levels are hit'
      },
      earlyClosure: {
        title: 'Early Position Closure',
        description: 'AI can recommend early closure on prediction reversal',
        status: 'active',
        details: 'New analysis with opposite bias + >80% confidence triggers closure review'
      },
      aiAnalysis: {
        title: 'AI Position Analysis',
        description: 'AI evaluates all open positions every 15 minutes',
        status: 'active',
        details: 'Recommends close/hold/adjust with >80% confidence threshold'
      },
      riskManagement: {
        title: 'Risk Management',
        description: '10% risk per trade with position sizing',
        status: 'active',
        details: 'RISK_PER_TRADE_PERCENT: 10 - Fixed 10% account risk per position'
      }
    },
    limitOrderManagement: {
      priceMonitoring: {
        title: 'Price Monitoring',
        description: 'Pending orders checked every 30 seconds',
        status: 'active',
        details: 'System monitors if price hits entry level for execution'
      },
      aiAnalysis: {
        title: 'AI Limit Order Analysis',
        description: 'AI evaluates pending orders every 15 minutes',
        status: 'active',
        details: 'Recommends keep/cancel/modify based on market conditions'
      },
      manualCancellation: {
        title: 'Manual Cancellation',
        description: 'Users can cancel pending orders via UI',
        status: 'active',
        details: 'Pending Orders section provides manual cancellation controls'
      },
      orderValidation: {
        title: 'Order Validation',
        description: 'Entry prices validated to be realistic',
        status: 'active',
        details: 'Entry must be within 10% of current price when order created'
      }
    },
    performanceRisk: {
      consecutiveLosses: {
        title: 'Consecutive Loss Protection',
        description: '4-hour cooldown after 8 consecutive losses',
        status: 'active',
        details: 'MAX_CONSECUTIVE_LOSSES: 8, COOLDOWN_HOURS: 4'
      },
      performanceTracking: {
        title: 'Performance Tracking',
        description: 'Comprehensive metrics calculation',
        status: 'active',
        details: 'Win rate, profit factor, drawdown, R multiple tracking'
      },
      accountSeparation: {
        title: 'Account Separation',
        description: 'Independent accounts for BTC and ETH',
        status: 'active',
        details: '100 USDT starting balance per symbol, separate tracking'
      },
      tradeHistory: {
        title: 'Trade History',
        description: 'Complete trade logging with pagination',
        status: 'active',
        details: '10 trades per page, BTC-only filtering, detailed outcomes'
      }
    },
    importantNotes: {
      paperTrading: {
        title: 'Paper Trading Only',
        description: 'This is a simulation system. No real money is involved.'
      },
      educational: {
        title: 'Educational Purpose',
        description: 'Designed for learning and evaluating AI performance, not financial advice.'
      },
      apiLimitations: {
        title: 'API Limitations',
        description: 'Analysis runs every 15 minutes due to free Groq API limits.'
      },
      dataFreshness: {
        title: 'Data Freshness',
        description: 'Price updates every 30 seconds for position monitoring.'
      },
      ethDisabled: {
        title: 'ETH Trading Disabled',
        description: 'ETH trading temporarily disabled to focus on BTC performance improvement.'
      }
    },
    tradingSettings: {
      title: 'Trading Settings',
      riskPerTrade: '10%',
      minConfidence: '70%',
      minRR: '2.0',
      maxPositions: '6 per symbol',
      enabledSymbols: 'BTC only',
      timeframes: '1h primary, 4h secondary'
    },
    systemSettings: {
      title: 'System Settings',
      priceUpdates: '30 seconds',
      aiAnalysis: '15 minutes',
      cooldownDuration: '4 hours',
      maxConsecutiveLosses: '8',
      timeframePriority: '1h primary, 4h secondary'
    }
  }
};

function MethodSelector({ onMethodChange }: { onMethodChange: (method: Method) => void }) {
  const searchParams = useSearchParams();
  const method = (searchParams.get('method') as Method) || 'ict';

  useEffect(() => {
    onMethodChange(method);
  }, [method, onMethodChange]);

  return null;
}

export default function RulesPage() {
  const [method, setMethod] = useState<Method>('ict');

  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-primary flex items-center justify-center">Loading...</div>}>
      <MethodSelector onMethodChange={setMethod} />
      <RulesPageContentWrapper method={method} />
    </Suspense>
  );
}

function RulesPageContentWrapper({ method }: { method: Method }) {
  const [language, setLanguage] = useState<Language>('vi');
  const t = translations[language];
  const methodName = method === 'ict' ? 'ICT Smart Money' : 'Kim Nghia (SMC + Volume + Fib)';
  const methodBadge = method === 'ict' ? 'ICT Methodology' : 'Kim Nghia Methodology';

  const methodConfig = method === 'ict' ? {
    minConfidence: '70%',
    minRR: '2.0',
    maxPositions: '6 mỗi ký hiệu',
    timeframes: '1h primary, 4h secondary',
    schedule: '0m, 15m, 30m, 45m',
    riskPerTrade: '10%'
  } : {
    minConfidence: '60%',
    minRR: '2.5',
    maxPositions: '6 mỗi ký hiệu',
    timeframes: 'H4 primary, H1 secondary',
    schedule: '7m30s, 22m30s, 37m30s, 52m30s',
    riskPerTrade: '10%'
  };

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <BookOpen className="w-8 h-8 text-accent-primary" />
            <h1 className="text-3xl font-bold text-foreground">{t.title}</h1>
          </div>
          <p className="text-foreground-secondary text-lg max-w-2xl mx-auto">
            {t.subtitle}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Badge variant="info" size="sm">{t.badges.btcFocus}</Badge>
            <Badge variant="success" size="sm">{methodBadge}</Badge>
            <Badge variant="warning" size="sm">{t.badges.aiPowered}</Badge>
            <Badge variant="default" size="sm">{methodName}</Badge>
          </div>
          
          {/* Method Toggle */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set('method', 'ict');
                window.location.href = url.toString();
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                method === 'ict' 
                  ? 'bg-accent-primary text-bg-primary' 
                  : 'bg-surface-1 text-foreground hover:bg-surface-2'
              }`}
            >
              ICT Smart Money
            </button>
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set('method', 'kim_nghia');
                window.location.href = url.toString();
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                method === 'kim_nghia' 
                  ? 'bg-accent-primary text-bg-primary' 
                  : 'bg-surface-1 text-foreground hover:bg-surface-2'
              }`}
            >
              Kim Nghia
            </button>
          </div>
          
          {/* Language Toggle */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <Globe className="w-4 h-4 text-foreground-secondary" />
            <button
              onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')}
              className="text-sm text-foreground-secondary hover:text-foreground transition-colors"
            >
              {language === 'vi' ? 'English' : 'Tiếng Việt'}
            </button>
          </div>
        </div>

        {/* Method-specific content */}
        {method === 'kim_nghia' ? (
          <KimNghiaRules language={language} />
        ) : (
          <>
            {/* Auto Entry Rules */}
            <section className="mb-12">
              <CardHeader 
                title={t.sections.autoEntry.title} 
                subtitle={t.sections.autoEntry.subtitle}
                icon={<Target className="w-6 h-6" />}
              />
              <Card className="mt-4">
                <div className="space-y-6">
                  <RuleCard
                    title={t.rules.confidenceThreshold.title}
                    description={t.rules.confidenceThreshold.description}
                    status="active"
                    details={t.rules.confidenceThreshold.details}
                  />
                  <RuleCard
                    title={t.rules.multiTimeframe.title}
                    description={t.rules.multiTimeframe.description}
                    status="active"
                    details={t.rules.multiTimeframe.details}
                  />
                  <RuleCard
                    title={t.rules.riskReward.title}
                    description={t.rules.riskReward.description}
                    status="active"
                    details={t.rules.riskReward.details}
                  />
                  <RuleCard
                    title={t.rules.positionLimit.title}
                    description={t.rules.positionLimit.description}
                    status="active"
                    details={t.rules.positionLimit.details}
                  />
                  <RuleCard
                    title={t.rules.tradingSessions.title}
                    description={t.rules.tradingSessions.description}
                    status="active"
                    details={t.rules.tradingSessions.details}
                  />
                </div>
              </Card>
            </section>

            {/* Order Types */}
            <section className="mb-12">
              <CardHeader 
                title={t.sections.orderTypes.title} 
                subtitle={t.sections.orderTypes.subtitle}
                icon={<Settings className="w-6 h-6" />}
              />
              <Card className="mt-4">
                <div className="space-y-6">
                  <OrderTypeCard
                    type={t.orderTypes.marketOrders.title}
                    condition={t.orderTypes.marketOrders.condition}
                    action={t.orderTypes.marketOrders.action}
                    example={t.orderTypes.marketOrders.example}
                  />
                  <OrderTypeCard
                    type={t.orderTypes.limitOrders.title}
                    condition={t.orderTypes.limitOrders.condition}
                    action={t.orderTypes.limitOrders.action}
                    example={t.orderTypes.limitOrders.example}
                  />
                </div>
              </Card>
            </section>

            {/* Position Management */}
            <section className="mb-12">
              <CardHeader 
                title={t.sections.positionManagement.title} 
                subtitle={t.sections.positionManagement.subtitle}
                icon={<Shield className="w-6 h-6" />}
              />
              <Card className="mt-4">
                <div className="space-y-6">
                  <RuleCard
                    title={t.positionManagement.stopLoss.title}
                    description={t.positionManagement.stopLoss.description}
                    status="active"
                    details={t.positionManagement.stopLoss.details}
                  />
                  <RuleCard
                    title={t.positionManagement.earlyClosure.title}
                    description={t.positionManagement.earlyClosure.description}
                    status={(t.positionManagement.earlyClosure.status || 'active') as 'active' | 'inactive' | 'conditional' | 'monitoring'}
                    details={t.positionManagement.earlyClosure.details}
                  />
                  <RuleCard
                    title={t.positionManagement.aiAnalysis.title}
                    description={t.positionManagement.aiAnalysis.description}
                    status={(t.positionManagement.aiAnalysis.status || 'active') as 'active' | 'inactive' | 'conditional' | 'monitoring'}
                    details={t.positionManagement.aiAnalysis.details}
                  />
                  <RuleCard
                    title={t.positionManagement.riskManagement.title}
                    description={t.positionManagement.riskManagement.description}
                    status={(t.positionManagement.riskManagement.status || 'active') as 'active' | 'inactive' | 'conditional' | 'monitoring'}
                    details={t.positionManagement.riskManagement.details}
                  />
                </div>
              </Card>
            </section>

            {/* Risk Management */}
            <section className="mb-12">
              <CardHeader 
                title={t.sections.performanceRisk.title} 
                subtitle={t.sections.performanceRisk.subtitle}
                icon={<AlertTriangle className="w-6 h-6" />}
              />
              <Card className="mt-4">
                <div className="space-y-6">
                  <RuleCard
                    title={t.performanceRisk.consecutiveLosses.title}
                    description={t.performanceRisk.consecutiveLosses.description}
                    status={(t.performanceRisk.consecutiveLosses.status || 'active') as 'active' | 'inactive' | 'conditional' | 'monitoring'}
                    details={t.performanceRisk.consecutiveLosses.details}
                  />
                  <RuleCard
                    title={t.performanceRisk.performanceTracking.title}
                    description={t.performanceRisk.performanceTracking.description}
                    status={(t.performanceRisk.performanceTracking.status || 'active') as 'active' | 'inactive' | 'conditional' | 'monitoring'}
                    details={t.performanceRisk.performanceTracking.details}
                  />
                  <RuleCard
                    title={t.performanceRisk.accountSeparation.title}
                    description={t.performanceRisk.accountSeparation.description}
                    status={(t.performanceRisk.accountSeparation.status || 'active') as 'active' | 'inactive' | 'conditional' | 'monitoring'}
                    details={t.performanceRisk.accountSeparation.details}
                  />
                  <RuleCard
                    title={t.performanceRisk.tradeHistory.title}
                    description={t.performanceRisk.tradeHistory.description}
                    status={(t.performanceRisk.tradeHistory.status || 'active') as 'active' | 'inactive' | 'conditional' | 'monitoring'}
                    details={t.performanceRisk.tradeHistory.details}
                  />
                </div>
              </Card>
            </section>

            {/* System Configuration */}
            <section className="mb-12">
              <CardHeader 
                title={t.sections.configuration.title} 
                subtitle={t.sections.configuration.subtitle}
                icon={<Clock className="w-6 h-6" />}
              />
              <Card className="mt-4">
                <ConfigSection title={t.tradingSettings.title}>
                  <ConfigItem label="Method" value={methodName} />
                  <ConfigItem label="Risk Per Trade" value={methodConfig.riskPerTrade} />
                  <ConfigItem label="Min Confidence" value={methodConfig.minConfidence} />
                  <ConfigItem label="Min R:R Ratio" value={methodConfig.minRR} />
                  <ConfigItem label="Max Positions" value={methodConfig.maxPositions} />
                  <ConfigItem label="Enabled Symbols" value={t.tradingSettings.enabledSymbols} />
                  <ConfigItem label="Timeframes" value={methodConfig.timeframes} />
                </ConfigSection>
                <ConfigSection title={t.systemSettings.title}>
                  <ConfigItem label="Analysis Schedule" value={methodConfig.schedule} />
                  <ConfigItem label="Price Updates" value={t.systemSettings.priceUpdates} />
                  <ConfigItem label="Cooldown Duration" value={t.systemSettings.cooldownDuration} />
                  <ConfigItem label="Max Consecutive Losses" value={t.systemSettings.maxConsecutiveLosses} />
                </ConfigSection>
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// Component Definitions
function RuleCard({ title, description, status, details }: { title: string; description: string; status: 'active' | 'inactive' | 'conditional' | 'monitoring'; details: string }) {
  const statusColors = {
    active: 'text-success',
    inactive: 'text-foreground-tertiary',
    conditional: 'text-warning',
    monitoring: 'text-info'
  };

  return (
    <div className="p-4 rounded-lg bg-surface-1 border border-border-default">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-medium text-foreground">{title}</h3>
        <span className={`text-xs font-medium ${statusColors[status]}`}>{status}</span>
      </div>
      <p className="text-sm text-foreground-secondary mb-2">{description}</p>
      <p className="text-xs text-foreground-tertiary font-mono">{details}</p>
    </div>
  );
}

function OrderTypeCard({ type, condition, action, example }: { type: string; condition: string; action: string; example: string }) {
  return (
    <div className="p-4 rounded-lg bg-surface-1 border border-border-default">
      <h3 className="font-medium text-foreground mb-3">{type}</h3>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-xs text-accent-primary mt-0.5">•</span>
          <div>
            <span className="text-xs text-foreground-tertiary">Condition: </span>
            <span className="text-sm text-foreground">{condition}</span>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-xs text-accent-primary mt-0.5">•</span>
          <div>
            <span className="text-xs text-foreground-tertiary">Action: </span>
            <span className="text-sm text-foreground">{action}</span>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-xs text-accent-primary mt-0.5">•</span>
          <div>
            <span className="text-xs text-foreground-tertiary">Example: </span>
            <span className="text-sm text-foreground">{example}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-foreground mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border-default last:border-0">
      <span className="text-sm text-foreground-secondary">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
