import { AlertTriangle } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-border-default bg-bg-secondary/80 mt-12">
      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-start gap-3 p-4 rounded-xl bg-warning-dim border border-warning/20 mb-6">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold tracking-tight text-warning mb-1">Risk disclaimer</h4>
            <p className="text-xs text-foreground-secondary leading-relaxed">
              Trading involves substantial risk of loss. Download Money provides AI-powered market analysis
              for educational and research purposes only. Past performance does not guarantee future results.
              This dashboard reflects live Binance Futures mainnet (exchange SL/TP, profit-protect, invalidation).
              Always conduct your own research and never invest more than you can afford to lose.
            </p>
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-foreground-muted">
          <p>
            Download Money • Powered by <span className="text-accent-primary">Groq AI</span> •
            Data from <span className="text-accent-primary">CoinGecko</span> / 
            <span className="text-accent-primary">Binance</span>
          </p>
          <p>
            AI Signal Workspace • Not Financial Advice
          </p>
        </div>
      </div>
    </footer>
  );
}
