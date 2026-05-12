'use client';

// Cache-bust: v{APP_VERSION}
import { useState, useEffect, Suspense } from 'react';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
import { Header } from './layout/Header';
import { Footer } from './layout/Footer';
import { HeroSection } from './sections/HeroSection';
import { TestnetPanel } from './components/crypto/TestnetPanel';
import { PredictionsSection } from './sections/PredictionsSection';
import { useTrends } from './hooks/useTrends';
import { Loader2, AlertCircle } from 'lucide-react';
import { Card } from './components/ui/Card';
import { SectionHeader } from './components/SectionHeader';
import { EmptyState } from './components/EmptyState';
import { Activity } from 'lucide-react';
import { SystemOverview } from './sections/SystemOverview';
import { SchedulerStatusPanel } from './sections/SchedulerStatusPanel';
import { CandleWarmupPanel } from './sections/CandleWarmupPanel';
import { MarketChartPanel } from './sections/MarketChartPanel';
import { IndicatorPanel } from './sections/IndicatorPanel';
import { TestnetBalancePanel } from './sections/TestnetBalancePanel';
import { OpenPositionsPanel } from './sections/OpenPositionsPanel';
import { ActiveOrdersPanel } from './sections/ActiveOrdersPanel';
import { TradeHistoryPanel } from './sections/TradeHistoryPanel';
import { SignalGatePanel } from './sections/SignalGatePanel';
import { NoTradeReasonsPanel } from './sections/NoTradeReasonsPanel';
import { RiskEnginePanel } from './sections/RiskEnginePanel';
import { LlmDispatchPanel } from './sections/LlmDispatchPanel';
import { MemoryInsightsPanel } from './sections/MemoryInsightsPanel';
import { EventLogFeed } from './sections/EventLogFeed';

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-primary flex items-center justify-center"><Loader2 className="w-12 h-12 text-accent-primary animate-spin" /></div>}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { data, loading: trendsLoading, error: trendsError, refetch } = useTrends('kim_nghia');
  const [isTriggering, setIsTriggering] = useState(false);

  const prices = data?.prices;
  const analysis = data?.analysis;
  const lastPriceUpdate = prices?.timestamp || data?.lastUpdated;
  const lastAnalysisUpdate = data?.lastUpdated;

  const handleRefresh = () => {
    refetch();
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
          <p className="text-foreground-secondary">Loading Download Money workspace...</p>
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
        {/* Hero Section - Download Money overview */}
        <HeroSection
          btcData={data?.prices.btc}
          ethData={data?.prices.eth}
          btcAnalysis={data?.analysis.btc}
          ethAnalysis={data?.analysis.eth}
          showEthTrading={false}
          method="kim_nghia"
        />

        {/* Signal Timeline */}
        <PredictionsSection symbol="BTC" method="kim_nghia" />

        {/* Testnet Panel */}
        <TestnetPanel />

        {/* NEW: 3-Column Dashboard Layout for Big Update v3 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
          {/* Column 1: System Overview + Risk Engine + No-Trade Reasons */}
          <div className="space-y-6">
            <SystemOverview />
            <SchedulerStatusPanel />
            <CandleWarmupPanel />
            <RiskEnginePanel />
            <NoTradeReasonsPanel />
          </div>

          {/* Column 2: Market Chart + Indicators + Setup markers */}
          <div className="space-y-6">
            <MarketChartPanel symbol="BTC" method="kim_nghia" />
            <IndicatorPanel />
          </div>

          {/* Column 3: Testnet Account Center + Positions + Orders + LLM/Memory */}
          <div className="space-y-6">
            <TestnetBalancePanel />
            <OpenPositionsPanel />
            <ActiveOrdersPanel />
            <TradeHistoryPanel />
            <SignalGatePanel />
            <LlmDispatchPanel />
            <MemoryInsightsPanel />
          </div>
        </div>

        {/* Event Log Feed - Full Width */}
        <div className="mt-8">
          <EventLogFeed />
        </div>
      </main>

      <Footer />
    </div>
  );
}
