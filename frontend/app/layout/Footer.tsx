import { AlertTriangle } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-border-default bg-bg-secondary mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Disclaimer */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-warning-dim border border-warning/20 mb-6">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-warning mb-1">Risk Disclaimer</h4>
            <p className="text-xs text-foreground-secondary leading-relaxed">
              Crypto trading involves substantial risk of loss. This platform provides AI-powered analysis 
              for educational purposes only. Past performance does not guarantee future results. 
              Paper trading simulates real market conditions but may differ from actual trading. 
              Always conduct your own research and never invest more than you can afford to lose.
            </p>
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-foreground-muted">
          <p>
            Powered by <span className="text-accent-primary">Groq AI</span> • 
            Data from <span className="text-accent-primary">CoinGecko</span> / 
            <span className="text-accent-primary">Binance</span>
          </p>
          <p>
            Paper Trading Simulation • Not Financial Advice
          </p>
        </div>
      </div>
    </footer>
  );
}
