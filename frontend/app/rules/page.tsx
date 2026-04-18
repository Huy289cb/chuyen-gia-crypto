'use client';

import { useState } from 'react';
import { BookOpen, Settings, Target, Shield, Clock, TrendingUp, AlertTriangle, CheckCircle, XCircle, Info, Globe } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

type Language = 'vi' | 'en';

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
        description: 'Tối đa 8 vị thế BTC đồng thởi',
        details: 'MAX_POSITIONS_PER_SYMBOL: 8 - Từ chối vị thế mới nếu đạt giới hạn'
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
        description: '1% rủi ro mỗi lệnh với tính toán kích thước vị thế',
        status: 'active',
        details: 'RISK_PER_TRADE_PERCENT: 1 - 1% rủi ro tài khoản cố định mỗi vị thế'
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
      riskPerTrade: '1%',
      minConfidence: '70%',
      minRR: '2.0',
      maxPositions: '8 BTC',
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
        description: 'Maximum 8 concurrent BTC positions',
        details: 'MAX_POSITIONS_PER_SYMBOL: 8 - New positions rejected if limit reached'
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
        description: '1% risk per trade with position sizing',
        status: 'active',
        details: 'RISK_PER_TRADE_PERCENT: 1 - Fixed 1% account risk per position'
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
      riskPerTrade: '1%',
      minConfidence: '70%',
      minRR: '2.0',
      maxPositions: '8 BTC',
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

export default function RulesPage() {
  const [language, setLanguage] = useState<Language>('vi');
  const t = translations[language];

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
            <Badge variant="success" size="sm">{t.badges.ictMethodology}</Badge>
            <Badge variant="warning" size="sm">{t.badges.aiPowered}</Badge>
          </div>
          
          {/* Language Toggle */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <Globe className="w-4 h-4 text-foreground-secondary" />
            <button
              onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 bg-surface-1 hover:bg-surface-2 border border-border-default hover:border-border-strong text-foreground-secondary hover:text-foreground"
            >
              <span className="text-sm font-medium">
                {language === 'vi' ? 'Tiếng Việt' : 'English'}
              </span>
              <span className="text-xs text-foreground-tertiary">
                ({language === 'vi' ? 'EN' : 'VI'})
              </span>
            </button>
          </div>
        </div>

        {/* Auto-Entry Rules */}
        <section className="mb-12">
          <CardHeader 
            title={t.sections.autoEntry.title} 
            subtitle={t.sections.autoEntry.subtitle}
            icon={<Target className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-6">
              <RuleCard
                title={t.rules.symbolEnablement.title}
                description={t.rules.symbolEnablement.description}
                status="active"
                details={t.rules.symbolEnablement.details}
              />
              <RuleCard
                title={t.rules.confidenceThreshold.title}
                description={t.rules.confidenceThreshold.description}
                status="active"
                details={t.rules.confidenceThreshold.details}
              />
              <RuleCard
                title={t.rules.clearBias.title}
                description={t.rules.clearBias.description}
                status="active"
                details={t.rules.clearBias.details}
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
                title={t.rules.cooldown.title}
                description={t.rules.cooldown.description}
                status="active"
                details={t.rules.cooldown.details}
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
              <OrderTypeCard
                type={t.orderTypes.limitExecution.title}
                condition={t.orderTypes.limitExecution.condition}
                action={t.orderTypes.limitExecution.action}
                example={t.orderTypes.limitExecution.example}
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
                status="active"
                details={t.positionManagement.earlyClosure.details}
              />
              <RuleCard
                title={t.positionManagement.aiAnalysis.title}
                description={t.positionManagement.aiAnalysis.description}
                status="active"
                details={t.positionManagement.aiAnalysis.details}
              />
              <RuleCard
                title={t.positionManagement.riskManagement.title}
                description={t.positionManagement.riskManagement.description}
                status="active"
                details={t.positionManagement.riskManagement.details}
              />
            </div>
          </Card>
        </section>

        {/* Limit Order Management */}
        <section className="mb-12">
          <CardHeader 
            title={t.sections.limitOrderManagement.title} 
            subtitle={t.sections.limitOrderManagement.subtitle}
            icon={<Clock className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-6">
              <RuleCard
                title={t.limitOrderManagement.priceMonitoring.title}
                description={t.limitOrderManagement.priceMonitoring.description}
                status="active"
                details={t.limitOrderManagement.priceMonitoring.details}
              />
              <RuleCard
                title={t.limitOrderManagement.aiAnalysis.title}
                description={t.limitOrderManagement.aiAnalysis.description}
                status="active"
                details={t.limitOrderManagement.aiAnalysis.details}
              />
              <RuleCard
                title={t.limitOrderManagement.manualCancellation.title}
                description={t.limitOrderManagement.manualCancellation.description}
                status="active"
                details={t.limitOrderManagement.manualCancellation.details}
              />
              <RuleCard
                title={t.limitOrderManagement.orderValidation.title}
                description={t.limitOrderManagement.orderValidation.description}
                status="active"
                details={t.limitOrderManagement.orderValidation.details}
              />
            </div>
          </Card>
        </section>

        {/* Performance & Cooldown */}
        <section className="mb-12">
          <CardHeader 
            title={t.sections.performanceRisk.title} 
            subtitle={t.sections.performanceRisk.subtitle}
            icon={<TrendingUp className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-6">
              <RuleCard
                title={t.performanceRisk.consecutiveLosses.title}
                description={t.performanceRisk.consecutiveLosses.description}
                status="active"
                details={t.performanceRisk.consecutiveLosses.details}
              />
              <RuleCard
                title={t.performanceRisk.performanceTracking.title}
                description={t.performanceRisk.performanceTracking.description}
                status="active"
                details={t.performanceRisk.performanceTracking.details}
              />
              <RuleCard
                title={t.performanceRisk.accountSeparation.title}
                description={t.performanceRisk.accountSeparation.description}
                status="active"
                details={t.performanceRisk.accountSeparation.details}
              />
              <RuleCard
                title={t.performanceRisk.tradeHistory.title}
                description={t.performanceRisk.tradeHistory.description}
                status="active"
                details={t.performanceRisk.tradeHistory.details}
              />
            </div>
          </Card>
        </section>

        {/* Important Notes */}
        <section className="mb-12">
          <CardHeader 
            title={t.sections.importantNotes.title} 
            subtitle={t.sections.importantNotes.subtitle}
            icon={<AlertTriangle className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="space-y-4">
              <NoteCard
                type="warning"
                title={t.importantNotes.paperTrading.title}
                description={t.importantNotes.paperTrading.description}
              />
              <NoteCard
                type="info"
                title={t.importantNotes.educational.title}
                description={t.importantNotes.educational.description}
              />
              <NoteCard
                type="warning"
                title={t.importantNotes.apiLimitations.title}
                description={t.importantNotes.apiLimitations.description}
              />
              <NoteCard
                type="info"
                title={t.importantNotes.dataFreshness.title}
                description={t.importantNotes.dataFreshness.description}
              />
              <NoteCard
                type="warning"
                title={t.importantNotes.ethDisabled.title}
                description={t.importantNotes.ethDisabled.description}
              />
            </div>
          </Card>
        </section>

        {/* Configuration Summary */}
        <section className="mb-12">
          <CardHeader 
            title={t.sections.configuration.title} 
            subtitle={t.sections.configuration.subtitle}
            icon={<Settings className="w-6 h-6" />}
          />
          <Card className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ConfigSection title={t.tradingSettings.title}>
                <ConfigItem label="Risk Per Trade" value={t.tradingSettings.riskPerTrade} />
                <ConfigItem label="Min Confidence" value={t.tradingSettings.minConfidence} />
                <ConfigItem label="Min R:R Ratio" value={t.tradingSettings.minRR} />
                <ConfigItem label="Max Positions" value={t.tradingSettings.maxPositions} />
                <ConfigItem label="Enabled Symbols" value={t.tradingSettings.enabledSymbols} />
                <ConfigItem label="Timeframes" value={t.tradingSettings.timeframes} />
              </ConfigSection>
              <ConfigSection title={t.systemSettings.title}>
                <ConfigItem label="Price Updates" value={t.systemSettings.priceUpdates} />
                <ConfigItem label="AI Analysis" value={t.systemSettings.aiAnalysis} />
                <ConfigItem label="Cooldown Duration" value={t.systemSettings.cooldownDuration} />
                <ConfigItem label="Max Consecutive Losses" value={t.systemSettings.maxConsecutiveLosses} />
                <ConfigItem label="Timeframe Priority" value={t.systemSettings.timeframePriority} />
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
