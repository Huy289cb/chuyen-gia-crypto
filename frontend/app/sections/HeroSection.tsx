'use client';

import { CryptoCard } from '../components/crypto/CryptoCard';
import type { PriceData, Analysis } from '../types';

interface HeroSectionProps {
  btcData?: PriceData;
  ethData?: PriceData;
  btcAnalysis?: Analysis;
  ethAnalysis?: Analysis;
}

export function HeroSection({ btcData, ethData, btcAnalysis, ethAnalysis }: HeroSectionProps) {
  return (
    <section className="mb-8">
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
        />
      </div>
    </section>
  );
}
