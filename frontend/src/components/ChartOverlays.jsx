import { useEffect } from 'react';
import { MapPin, TrendingUp, TrendingDown, Layers, Box, Droplets, Activity } from 'lucide-react';

export function ChartOverlays({ symbol, chartRef, positions, ictLevels, showEntrySLTP, showICTMarkers, showTradeHistory }) {
  useEffect(() => {
    if (!chartRef.current) return;

    const chart = chartRef.current;
    let markers = [];

    // Clear existing markers
    const clearMarkers = () => {
      // Note: lightweight-charts doesn't have a built-in way to clear all markers
      // We would need to track them and remove individually
      // For now, we'll add new markers on top
    };

    // Add Entry/SL/TP markers from positions
    if (showEntrySLTP && positions && positions.length > 0) {
      positions.forEach((position, index) => {
        if (position.status !== 'open') return;

        const series = chart.getSeries();
        if (!series) return;

        // Entry marker
        series.createPriceLine({
          price: position.entry_price,
          color: position.side === 'long' ? '#10b981' : '#ef4444',
          lineWidth: 2,
          lineStyle: 1,
          title: `Entry ${index + 1}`
        });

        // SL marker (dashed)
        series.createPriceLine({
          price: position.stop_loss,
          color: '#ef4444',
          lineWidth: 2,
          lineStyle: 2,
          title: 'SL'
        });

        // TP marker (dashed)
        series.createPriceLine({
          price: position.take_profit,
          color: '#10b981',
          lineWidth: 2,
          lineStyle: 2,
          title: 'TP'
        });
      });
    }

    // Add ICT markers
    if (showICTMarkers && ictLevels) {
      const series = chart.getSeries();
      if (!series) return;

      const { liquidity, order_blocks, fvg, bos, choch } = ictLevels;

      // Liquidity markers
      if (liquidity && Array.isArray(liquidity)) {
        liquidity.forEach((price, i) => {
          series.createPriceLine({
            price: price,
            color: '#3b82f6',
            lineWidth: 1,
            lineStyle: 3,
            title: i === 0 ? 'Thanh khoản' : ''
          });
        });
      }

      // Order block markers
      if (order_blocks && Array.isArray(order_blocks)) {
        order_blocks.forEach((price, i) => {
          series.createPriceLine({
            price: price,
            color: '#8b5cf6',
            lineWidth: 1,
            lineStyle: 3,
            title: i === 0 ? 'OB' : ''
          });
        });
      }

      // FVG markers
      if (fvg && Array.isArray(fvg)) {
        fvg.forEach((price, i) => {
          series.createPriceLine({
            price: price,
            color: '#f59e0b',
            lineWidth: 1,
            lineStyle: 3,
            title: i === 0 ? 'FVG' : ''
          });
        });
      }

      // BOS markers
      if (bos && Array.isArray(bos)) {
        bos.forEach((price, i) => {
          series.createPriceLine({
            price: price,
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: 1,
            title: i === 0 ? 'BOS' : ''
          });
        });
      }

      // CHOCH markers
      if (choch && Array.isArray(choch)) {
        choch.forEach((price, i) => {
          series.createPriceLine({
            price: price,
            color: '#06b6d4',
            lineWidth: 2,
            lineStyle: 1,
            title: i === 0 ? 'CHOCH' : ''
          });
        });
      }
    }

    // Add trade history markers
    if (showTradeHistory && positions && positions.length > 0) {
      const series = chart.getSeries();
      if (!series) return;

      positions.forEach((position) => {
        if (position.status === 'open') return;

        // Entry point marker
        series.createPriceLine({
          price: position.entry_price,
          color: position.side === 'long' ? '#10b981' : '#ef4444',
          lineWidth: 1,
          lineStyle: 1,
          title: position.side === 'long' ? '▲' : '▼'
        });

        // Exit point marker
        if (position.close_price) {
          series.createPriceLine({
            price: position.close_price,
            color: position.realized_pnl >= 0 ? '#10b981' : '#ef4444',
            lineWidth: 1,
            lineStyle: 1,
            title: position.realized_pnl >= 0 ? '✓' : '✗'
          });
        }
      });
    }

    return () => {
      // Cleanup would go here if we tracked markers
      clearMarkers();
    };
  }, [chartRef, positions, ictLevels, showEntrySLTP, showICTMarkers, showTradeHistory]);

  // This component doesn't render anything directly
  // It just adds overlays to the chart when mounted
  return null;
}

// Helper component to extract prices from text
export function extractPrices(text, currentPrice) {
  if (!text) return [];
  const matches = text.match(/\$?[\d,]+\.?\d*[kK]?/g);
  return matches ? matches.map(m => {
    let val = m.replace(/[$,]/g, '');
    if (m.toLowerCase().includes('k')) val = parseFloat(val) * 1000;
    return parseFloat(val);
  }).filter(p => !isNaN(p) && p > 0 && p > currentPrice * 0.7 && p < currentPrice * 1.3) : [];
}

// Overlay controls component
export function OverlayControls({ showEntrySLTP, showICTMarkers, showTradeHistory, onToggle }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <label className="flex items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          checked={showEntrySLTP}
          onChange={() => onToggle('showEntrySLTP')}
          className="rounded"
        />
        <span className="text-gray-600">Entry/SL/TP</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          checked={showICTMarkers}
          onChange={() => onToggle('showICTMarkers')}
          className="rounded"
        />
        <span className="text-gray-600">ICT Markers</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          checked={showTradeHistory}
          onChange={() => onToggle('showTradeHistory')}
          className="rounded"
        />
        <span className="text-gray-600">Trade History</span>
      </label>
    </div>
  );
}
