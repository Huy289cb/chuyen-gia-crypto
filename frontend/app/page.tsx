'use client';

import { Suspense, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Header } from './layout/Header';
import { Footer } from './layout/Footer';
import { DashboardCommandStrip } from './components/DashboardCommandStrip';
import { DashboardSectionNav } from './components/DashboardSectionNav';
import { DashboardZone } from './components/DashboardZone';
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
import { TelegramAiPanel } from './sections/TelegramAiPanel';
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

      <DashboardSectionNav />

      <main
        id="main-content"
        className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 overflow-x-hidden animate-fade-in space-y-10 sm:space-y-12"
      >
        {/* 1. Tóm tắt — trả lời "hệ thống đang ở đâu?" trong 5 giây */}
        <DashboardZone
          id="overview"
          title="Tóm tắt"
          description="Trạng thái pipeline, tín hiệu, vị thế và PnL — xem trước khi đi sâu chi tiết."
        >
          <DashboardCommandStrip />
          <div className="mt-4">
            <SystemOverview />
          </div>
        </DashboardZone>

        {/* 2. Thị trường — bối cảnh giá trước khi quyết định */}
        <DashboardZone
          id="market"
          title="Thị trường"
          description="Biểu đồ BTC và chỉ báo Kim Nghia trên khung thời gian đang chọn."
        >
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            <div className="xl:col-span-8 min-w-0">
              <MarketChartPanel symbol="BTC" method="kim_nghia" />
            </div>
            <div className="xl:col-span-4 min-w-0">
              <IndicatorPanel />
            </div>
          </div>
        </DashboardZone>

        {/* 3. Thực thi — tiền, vị thế, lệnh */}
        <DashboardZone
          id="execution"
          title="Thực thi"
          description="Số dư testnet, vị thế đang mở, lệnh chờ và lịch sử giao dịch."
        >
          <div className="space-y-4">
            <TestnetBalancePanel />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
              <div id="open-positions" className="min-w-0">
                <OpenPositionsPanel />
              </div>
              <div className="min-w-0">
                <ActiveOrdersPanel />
              </div>
              <div className="min-w-0 md:col-span-2 xl:col-span-1">
                <TradeHistoryPanel />
              </div>
            </div>
          </div>
        </DashboardZone>

        {/* 4. Pipeline — tại sao vào lệnh / không vào lệnh */}
        <DashboardZone
          id="pipeline"
          title="Pipeline quyết định"
          description="Luồng MarketScan → Signal Gate → Risk → LLM. Xem chi tiết khi tín hiệu bị chặn."
        >
          <div className="space-y-4">
            <DecisionFlowPanel variant="full" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div id="signal-gate" className="min-w-0">
                <SignalGatePanel />
              </div>
              <div id="risk-engine" className="min-w-0">
                <RiskEnginePanel />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div id="llm-dispatch" className="min-w-0">
                <LlmDispatchPanel />
              </div>
              <div className="min-w-0">
                <NoTradeReasonsPanel />
              </div>
            </div>
          </div>
        </DashboardZone>

        {/* 5. Hệ thống — vận hành & debug */}
        <DashboardZone
          id="system"
          title="Hệ thống"
          description="Scheduler, warmup nến, bộ nhớ AI và nhật ký sự kiện."
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="space-y-4 min-w-0">
              <SchedulerStatusPanel />
              <CandleWarmupPanel />
              <MemoryInsightsPanel />
              <TelegramAiPanel />
            </div>
            <div id="event-log" className="min-w-0">
              <EventLogFeed refreshToken={eventLogRefreshToken} />
            </div>
          </div>
        </DashboardZone>
      </main>

      <Footer />
    </div>
  );
}
