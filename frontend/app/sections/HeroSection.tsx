'use client';

import { CryptoCard } from '../components/crypto/CryptoCard';
import { PriceChartContainer } from '../components/crypto/PriceChartContainer';
import { CardHeader } from '../components/ui/Card';
import { BarChart3 } from 'lucide-react';
import type { PriceData, Analysis } from '../types';

interface HeroSectionProps {
  btcData?: PriceData;
  ethData?: PriceData;
  btcAnalysis?: Analysis;
  ethAnalysis?: Analysis;
  showEthTrading?: boolean; // New prop to control ETH trading visibility
  method?: string;
}

export function HeroSection({ btcData, ethData, btcAnalysis, ethAnalysis, showEthTrading = false, method = 'ict' }: HeroSectionProps) {
  return (
    <section className="mb-8 space-y-6">
      {/* Crypto Cards - Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <CryptoCard 
          name="Bitcoin"
          symbol="BTC"
          data={btcData}
          analysis={btcAnalysis}
          color="#f7931a"
        />
        <CryptoCard 
          name="Ethereum"
          symbol="ETH"
          data={ethData}
          analysis={ethAnalysis}
          color="#627eea"
          showTradingInfo={false} // Always show price data, hide trading controls
        />
      </div>

      {/* Price Chart - Analysis */}
      <div>
        <CardHeader 
          title="Price Analysis" 
          subtitle="1H candlestick with prediction levels"
          icon={<BarChart3 className="w-5 h-5" />}
        />
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <PriceChartContainer 
            symbol="BTC"
            predictions={btcAnalysis?.predictions ? Object.values(btcAnalysis.predictions) : undefined}
            analysis={btcAnalysis}
            color="#f7931a"
            method={method}
          />
          <PriceChartContainer 
            symbol="ETH"
            predictions={ethAnalysis?.predictions ? Object.values(ethAnalysis.predictions) : undefined}
            analysis={ethAnalysis}
            color="#627eea"
            method={method}
          />
        </div>
      </div>
    </section>
  );
}
