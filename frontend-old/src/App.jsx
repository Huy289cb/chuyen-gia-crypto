import { CoinChart } from './components/PriceChart';
import { MarketOverview, RefreshButton } from './components/MarketOverview';
import { Disclaimer } from './components/Disclaimer';
import { DashboardHeader } from './components/DashboardHeader';
import { PositionPanel } from './components/PositionPanel';
import { TradeHistoryPanel } from './components/TradeHistoryPanel';
import { PredictionTimeline } from './components/PredictionTimeline';
import { PerformanceCharts } from './components/PerformanceCharts';
import { AdvancedMetrics } from './components/AdvancedMetrics';
import { useTrends } from './hooks/useTrends';
import { usePaperTrading } from './hooks/usePaperTrading';
import { Zap, Loader2, AlertCircle } from 'lucide-react';

function App() {
  const { data, loading, error, refetch } = useTrends();
  const { accounts, positions, tradeHistory, loading: ptLoading, resetAccount, closePosition } = usePaperTrading();

  const prices = data?.prices || {};
  const analysis = data?.analysis || {};
  const marketData = data?.prices?.marketData;
  const disclaimer = analysis?.disclaimer;
  const lastPriceUpdate = prices?.timestamp || data?.lastUpdated;
  const lastAnalysisUpdate = data?.lastUpdated;

  const handleRefresh = () => {
    refetch();
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Chưa sẵn sàng</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-gradient-to-br from-orange-500 to-blue-500 rounded-xl">
                <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div>
                <h1 className="text-base sm:text-xl font-bold text-gray-900">Crypto Trend Analyzer</h1>
                <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">Phân tích xu hướng BTC/ETH với AI + Paper Trading</p>
              </div>
            </div>
            <RefreshButton onRefresh={handleRefresh} loading={loading} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
        {/* Charts Grid - 50/50 Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <CoinChart 
            name="Bitcoin"
            symbol="BTC"
            data={prices.btc}
            analysis={analysis.btc}
            color="#f97316"
            predictions={analysis.btc?.predictions ? Object.entries(analysis.btc.predictions).map(([tf, pred]) => ({ timeframe: tf, ...pred })) : []}
          />
          <CoinChart 
            name="Ethereum"
            symbol="ETH"
            data={prices.eth}
            analysis={analysis.eth}
            color="#3b82f6"
            predictions={analysis.eth?.predictions ? Object.entries(analysis.eth.predictions).map(([tf, pred]) => ({ timeframe: tf, ...pred })) : []}
          />
        </div>

        {/* Paper Trading Dashboard Header */}
        <DashboardHeader accounts={accounts} lastPriceUpdate={lastPriceUpdate} lastAnalysisUpdate={lastAnalysisUpdate} />

        {/* Market Overview */}
        <div className="mb-6">
          <MarketOverview
            analysis={analysis}
            lastUpdated={prices.timestamp}
            marketData={marketData}
          />
        </div>

        {/* Position Panel */}
        <div className="mb-6">
          <PositionPanel positions={positions} onClosePosition={closePosition} />
        </div>

        {/* Trade History Panel */}
        <div className="mb-6">
          <TradeHistoryPanel trades={tradeHistory} />
        </div>

        {/* Prediction Timeline */}
        <div className="mb-6">
          <PredictionTimeline symbol="BTC" limit={50} />
        </div>

        {/* Performance Charts */}
        <div className="mb-6">
          <PerformanceCharts symbol="BTC" />
        </div>

        {/* Advanced Metrics */}
        <div className="mb-6">
          <AdvancedMetrics symbol="BTC" />
        </div>
        {/* Disclaimer */}
        <Disclaimer />

        {/* Footer */}
        <footer className="mt-8 text-center text-sm text-gray-400">
          <p>Phân tích bởi AI • Dữ liệu từ CoinGecko/Binance • Paper Trading Simulation</p>
        </footer>
      </main>
    </div>
  );
}

export default App;
