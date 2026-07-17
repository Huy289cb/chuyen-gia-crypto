'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, Globe, ArrowLeft } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { V3Rules, type RulesLanguage } from './v3-rules';

const header = {
  vi: {
    title: 'Big Update v3 — Quy trình & Quy tắc',
    subtitle:
      'Hệ thống giao dịch BTC chọn lọc: ít lệnh, chất lượng cao, kiểm soát rủi ro cứng, Groq chỉ khi setup đạt chuẩn.',
    backDashboard: 'Về Dashboard',
    principle: 'Nguyên tắc: “Lệnh tốt nhất là lệnh bạn KHÔNG vào.”',
    toggle: 'English',
    badges: {
      v3: 'Big Update v3',
      btc: 'Chỉ BTC',
      method: 'Kim Nghia',
      testnet: 'Binance Futures Mainnet',
    },
  },
  en: {
    title: 'Big Update v3 — Pipeline & Rules',
    subtitle:
      'Selective BTC trading: fewer trades, higher quality, hard risk gates, Groq only on qualified setups.',
    backDashboard: 'Back to Dashboard',
    principle: 'Principle: “The best trade is the one you do NOT take.”',
    toggle: 'Tiếng Việt',
    badges: {
      v3: 'Big Update v3',
      btc: 'BTC Only',
      method: 'Kim Nghia',
      testnet: 'Binance Futures Mainnet',
    },
  },
} as const;

export default function RulesPage() {
  const [language, setLanguage] = useState<RulesLanguage>('vi');
  const t = header[language];

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-foreground-secondary hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.backDashboard}
        </Link>

        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-4">
            <BookOpen className="w-8 h-8 text-accent-primary" />
            <h1 className="text-3xl font-bold text-foreground">{t.title}</h1>
          </div>
          <p className="text-foreground-secondary text-lg max-w-2xl mx-auto">{t.subtitle}</p>
          <p className="text-sm text-accent-primary mt-3 font-medium">{t.principle}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Badge variant="success" size="sm">
              {t.badges.v3}
            </Badge>
            <Badge variant="info" size="sm">
              {t.badges.btc}
            </Badge>
            <Badge variant="default" size="sm">
              {t.badges.method}
            </Badge>
            <Badge variant="warning" size="sm">
              {t.badges.testnet}
            </Badge>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Globe className="w-4 h-4 text-foreground-secondary" />
            <button
              type="button"
              onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')}
              className="text-sm text-foreground-secondary hover:text-foreground transition-colors"
            >
              {t.toggle}
            </button>
          </div>
        </div>

        <V3Rules language={language} />
      </div>
    </div>
  );
}
