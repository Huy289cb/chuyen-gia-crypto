import Link from 'next/link';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { FuturesPortfolioPaperPanel } from '../components/FuturesPortfolioPaperPanel';

export default function FuturesPaperPage() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-foreground-secondary hover:text-foreground">
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Về bảng điều khiển
        </Link>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-6 h-6 text-accent-primary" aria-hidden />
            <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Danh mục Futures mô phỏng</h1>
          </div>
          <p className="text-sm text-foreground-secondary leading-relaxed">
            Theo dõi chiến lược đang chọn với một ví chung 100 USDT và ngân sách lỗ cố định 10 USDT mỗi ngày Việt Nam.
          </p>
        </div>
        <FuturesPortfolioPaperPanel />
      </main>
    </div>
  );
}
