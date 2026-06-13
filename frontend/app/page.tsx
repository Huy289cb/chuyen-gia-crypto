'use client';

import { Suspense, useState } from 'react';
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
import { DecisionFlowPanel } from './sections/DecisionFlowPanel';
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
  const [eventLogRefreshToken, setEventLogRefreshToken] = useState(0);

  const isLoading =
    summary.loading || account.loading || intelligence.loading || market.loading;

  const handleRefresh = () => {
    summary.refresh();
    account.refresh();
    intelligence.refresh();
    market.refresh();
    setEventLogRefreshToken((t) => t + 1);
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

      <main
        id="main-content"
        className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 overflow-x-hidden animate-fade-in"
      >
        <div className="animate-slide-up">
          <DecisionFlowPanel className="mb-6" />
        </div>

        {/* Primary workspace: account | market | execution */}
        <section
          aria-label="Trading workspace"
          className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-6 items-start"
        >
          <aside className="xl:col-span-3 space-y-6 min-w-0 order-2 xl:order-1">
            <TestnetBalancePanel />
            <SystemOverview />
          </aside>

          <div className="xl:col-span-6 space-y-6 min-w-0 order-1 xl:order-2">
            <MarketChartPanel symbol="BTC" method="kim_nghia" />
            <IndicatorPanel />
            <div id="event-log">
              <EventLogFeed refreshToken={eventLogRefreshToken} />
            </div>
          </div>

          <aside className="xl:col-span-3 space-y-6 min-w-0 order-3">
            <div id="open-positions">
              <OpenPositionsPanel />
            </div>
            <ActiveOrdersPanel />
            <TradeHistoryPanel />
          </aside>
        </section>

        {/* Pipeline ops & intelligence — balanced two columns */}
        <section
          aria-label="Pipeline and intelligence"
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start"
        >
          <div className="space-y-6 min-w-0">
            <SchedulerStatusPanel />
            <CandleWarmupPanel />
            <div id="risk-engine">
              <RiskEnginePanel />
            </div>
            <NoTradeReasonsPanel />
            <MemoryInsightsPanel />
          </div>

          <div className="space-y-6 min-w-0">
            <div id="signal-gate">
              <SignalGatePanel />
            </div>
            <div id="llm-dispatch">
              <LlmDispatchPanel />
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
