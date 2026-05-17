'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { Header } from './layout/Header';
import { Footer } from './layout/Footer';
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
import { V3DashboardDataProvider, useV3Dashboard } from './contexts/V3DashboardDataContext';

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-bg-primary flex items-center justify-center">
          <Loader2 className="w-12 h-12 text-accent-primary animate-spin" />
        </div>
      }
    >
      <V3DashboardDataProvider marketSymbol="BTC">
        <DashboardPage />
      </V3DashboardDataProvider>
    </Suspense>
  );
}

function DashboardPage() {
  const { summary, account, intelligence, market } = useV3Dashboard();

  const isLoading =
    summary.loading || account.loading || intelligence.loading || market.loading;

  const handleRefresh = () => {
    summary.refresh();
    account.refresh();
    intelligence.refresh();
    market.refresh();
  };

  const schedulerRuns = summary.data?.schedulers
    ?.map((s) => s.lastRunAt || s.lastRun)
    .filter(Boolean) as string[] | undefined;
  const lastDashboardUpdate = schedulerRuns?.length
    ? schedulerRuns.sort().at(-1)
    : intelligence.data?.signalGate?.timestamp;

  return (
    <div className="min-h-screen bg-bg-primary">
      <Header
        onRefresh={handleRefresh}
        isLoading={isLoading}
        lastDashboardUpdate={lastDashboardUpdate}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <SystemOverview />
            <SchedulerStatusPanel />
            <CandleWarmupPanel />
            <RiskEnginePanel />
            <NoTradeReasonsPanel />
          </div>

          <div className="space-y-6">
            <MarketChartPanel symbol="BTC" method="kim_nghia" />
            <IndicatorPanel />
          </div>

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

        <div className="mt-8">
          <EventLogFeed />
        </div>
      </main>

      <Footer />
    </div>
  );
}
