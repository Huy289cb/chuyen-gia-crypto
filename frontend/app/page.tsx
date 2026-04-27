'use client';

// Cache-bust: v{APP_VERSION}
import { useState, useEffect, Suspense } from 'react';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
import { Header } from './layout/Header';
import { Footer } from './layout/Footer';
import { HeroSection } from './sections/HeroSection';
import { TradingDashboard } from './sections/TradingDashboard';
import { PositionsSection } from './sections/PositionsSection';
import { HistorySection } from './sections/HistorySection';
import { PendingOrdersSection } from './sections/PendingOrdersSection';
import { PredictionsSection } from './sections/PredictionsSection';
import { PerformanceSection } from './sections/PerformanceSection';
import { TestnetPanel } from './components/crypto/TestnetPanel';
import { ComparisonDashboard } from './components/crypto/ComparisonDashboard';
import { useTrends } from './hooks/useTrends';
import { usePaperTrading } from './hooks/usePaperTrading';
import { Loader2, AlertCircle } from 'lucide-react';

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-primary flex items-center justify-center"><Loader2 className="w-12 h-12 text-accent-primary animate-spin" /></div>}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { data, loading: trendsLoading, error: trendsError, refetch } = useTrends('kim_nghia');
  const { accounts, positions, tradeHistory, loading: ptLoading, resetAccount, closePosition, refresh: refreshPaperTrading } = usePaperTrading('kim_nghia');
  const [activeTab, setActiveTab] = useState<'paper' | 'testnet' | 'comparison'>('paper');
  const [isTriggering, setIsTriggering] = useState(false);

  const prices = data?.prices;
  const analysis = data?.analysis;
  const lastPriceUpdate = prices?.timestamp || data?.lastUpdated;
  const lastAnalysisUpdate = data?.lastUpdated;

  const handleRefresh = () => {
    refetch();
    refreshPaperTrading();
  };

  const handleTriggerAnalysis = async () => {
    setIsTriggering(true);
    try {
      const response = await fetch('/api/analysis/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to trigger analysis');
      }
      
      // Wait a moment for the analysis to complete, then refresh
      setTimeout(() => {
        refetch();
        setIsTriggering(false);
      }, 2000);
    } catch (error) {
      console.error('Error triggering analysis:', error);
      setIsTriggering(false);
    }
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
        onTriggerAnalysis={handleTriggerAnalysis}
        isTriggering={isTriggering}
        isLoading={trendsLoading}
        lastPriceUpdate={lastPriceUpdate}
        lastAnalysisUpdate={lastAnalysisUpdate}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Hero Section - Crypto Cards with Charts */}
        <HeroSection
          btcData={data?.prices.btc}
          ethData={data?.prices.eth}
          btcAnalysis={data?.analysis.btc}
          ethAnalysis={data?.analysis.eth}
          showEthTrading={false}
          method="kim_nghia"
        />

        {/* Trading System Tabs */}
        <div className="mb-6">
          <div className="flex gap-2 border-b border-surface-2">
            <button
              onClick={() => setActiveTab('paper')}
              className={cn(
                'px-4 py-2 font-medium transition-colors',
                activeTab === 'paper' 
                  ? 'text-accent-primary border-b-2 border-accent-primary' 
                  : 'text-foreground-secondary hover:text-foreground'
              )}
            >
              Paper Trading
            </button>
            <button
              onClick={() => setActiveTab('testnet')}
              className={cn(
                'px-4 py-2 font-medium transition-colors',
                activeTab === 'testnet' 
                  ? 'text-accent-primary border-b-2 border-accent-primary' 
                  : 'text-foreground-secondary hover:text-foreground'
              )}
            >
              Binance Testnet
            </button>
            <button
              onClick={() => setActiveTab('comparison')}
              className={cn(
                'px-4 py-2 font-medium transition-colors',
                activeTab === 'comparison' 
                  ? 'text-accent-primary border-b-2 border-accent-primary' 
                  : 'text-foreground-secondary hover:text-foreground'
              )}
            >
              Comparison
            </button>
          </div>
        </div>

        {/* Paper Trading Dashboard */}
        {activeTab === 'paper' && (
          <TradingDashboard
            accounts={accounts}
            loading={ptLoading}
            onReset={resetAccount}
            method="kim_nghia"
          />
        )}

        {/* Testnet Panel */}
        {activeTab === 'testnet' && <TestnetPanel />}

        {/* Comparison Dashboard */}
        {activeTab === 'comparison' && <ComparisonDashboard />}

        {/* Open Positions - Only show on paper trading tab */}
        {activeTab === 'paper' && (
          <PositionsSection
            positions={positions}
            onClosePosition={closePosition}
          />
        )}

        {/* Pending Orders - Only show on paper trading tab */}
        {activeTab === 'paper' && <PendingOrdersSection method="kim_nghia" />}

        {/* Trade History - Only show on paper trading tab */}
        {activeTab === 'paper' && (
          <HistorySection
            symbol="BTC"
            method="kim_nghia"
          />
        )}

        {/* Prediction Timeline - Only show on paper trading tab */}
        {activeTab === 'paper' && (
          <PredictionsSection
            symbol="BTC"
            method="kim_nghia"
          />
        )}

        {/* Performance Charts & Metrics - Only show on paper trading tab */}
        {activeTab === 'paper' && (
          <PerformanceSection
            symbol="BTC"
            method="kim_nghia"
          />
        )}
      </main>

      <Footer />
    </div>
  );
}
