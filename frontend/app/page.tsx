'use client';

// Cache-bust: v2
import { Header } from './layout/Header';
import { Footer } from './layout/Footer';
import { HeroSection } from './sections/HeroSection';
import { TradingDashboard } from './sections/TradingDashboard';
import { PositionsSection } from './sections/PositionsSection';
import { HistorySection } from './sections/HistorySection';
import { PendingOrdersSection } from './sections/PendingOrdersSection';
import { PredictionsSection } from './sections/PredictionsSection';
import { PerformanceSection } from './sections/PerformanceSection';
import { useTrends } from './hooks/useTrends';
import { usePaperTrading } from './hooks/usePaperTrading';
import { Loader2, AlertCircle } from 'lucide-react';

export default function Home() {
  const { data, loading: trendsLoading, error: trendsError, refetch } = useTrends();
  const { accounts, positions, tradeHistory, loading: ptLoading, resetAccount, closePosition } = usePaperTrading();

  const prices = data?.prices;
  const analysis = data?.analysis;
  const lastPriceUpdate = prices?.timestamp || data?.lastUpdated;
  const lastAnalysisUpdate = data?.lastUpdated;

  const handleRefresh = () => {
    refetch();
  };

  // Initial loading state
  if (trendsLoading && !data) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-accent-primary animate-spin mx-auto mb-4" />
          <p className="text-foreground-secondary">Loading market data...</p>
        </div>
      </div>
    );
  }

  // Error state without data
  if (trendsError && !data) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <AlertCircle className="w-12 h-12 text-warning mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Service Unavailable</h2>
          <p className="text-foreground-secondary mb-4">{trendsError}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-secondary text-bg-primary font-medium rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <Header 
        onRefresh={handleRefresh} 
        isLoading={trendsLoading}
        lastPriceUpdate={lastPriceUpdate}
        lastAnalysisUpdate={lastAnalysisUpdate}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Hero Section - Crypto Cards with Charts */}
        <HeroSection 
          btcData={prices?.btc} 
          ethData={prices?.eth}
          btcAnalysis={analysis?.btc}
          ethAnalysis={analysis?.eth}
          showEthTrading={false} // Hide ETH trading information
        />

        {/* Paper Trading Dashboard */}
        <TradingDashboard 
          accounts={accounts}
          loading={ptLoading}
          onReset={resetAccount}
        />

        {/* Open Positions */}
        <PositionsSection 
          positions={positions}
          onClosePosition={closePosition}
        />

        {/* Pending Orders */}
        <PendingOrdersSection />

        {/* Trade History */}
        <HistorySection 
          trades={tradeHistory}
        />

        {/* Prediction Timeline */}
        <PredictionsSection 
          symbol="BTC"
        />

        {/* Performance Charts & Metrics */}
        <PerformanceSection 
          symbol="BTC"
        />
      </main>

      <Footer />
    </div>
  );
}
