import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertCircle, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, Target, Layers, Zap, Shield } from 'lucide-react';

const actionConfig = {
  buy: { 
    color: 'bg-green-500', 
    text: 'MUA', 
    icon: TrendingUp,
    textColor: 'text-green-600',
    bgColor: 'bg-green-50',
    barColor: 'bg-green-500',
    borderColor: 'border-green-200'
  },
  sell: { 
    color: 'bg-red-500', 
    text: 'BÁN', 
    icon: TrendingDown,
    textColor: 'text-red-600',
    bgColor: 'bg-red-50',
    barColor: 'bg-red-500',
    borderColor: 'border-red-200'
  },
  hold: { 
    color: 'bg-yellow-500', 
    text: 'GIỮ', 
    icon: Minus,
    textColor: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    barColor: 'bg-yellow-500',
    borderColor: 'border-yellow-200'
  }
};

const biasConfig = {
  bullish: { 
    color: 'bg-emerald-500', 
    text: 'BULLISH',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50'
  },
  bearish: { 
    color: 'bg-rose-500', 
    text: 'BEARISH',
    textColor: 'text-rose-700',
    bgColor: 'bg-rose-50'
  },
  neutral: { 
    color: 'bg-gray-400', 
    text: 'NEUTRAL',
    textColor: 'text-gray-600',
    bgColor: 'bg-gray-50'
  }
};

function ConfidenceBar({ confidence, colorClass }) {
  const percentage = Math.round(confidence * 100);
  
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-500">Độ tin cậy ICT</span>
        <span className="font-semibold text-gray-700">{percentage}%</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div 
          className={`h-full ${colorClass} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function TimeframeStructure({ timeframes }) {
  if (!timeframes) return null;
  
  const tfOrder = ['1d', '4h', '1h'];
  const tfLabels = { '1d': '1D', '4h': '4H', '1h': '1H' };
  
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cấu trúc Multi-Timeframe</p>
      {tfOrder.map(tf => {
        const desc = timeframes[tf];
        if (!desc) return null;
        
        const isBullish = desc.toLowerCase().includes('bullish') || desc.toLowerCase().includes('bos');
        const isBearish = desc.toLowerCase().includes('bearish') || desc.toLowerCase().includes('choch');
        const colorClass = isBullish ? 'text-emerald-600 bg-emerald-50' : 
                          isBearish ? 'text-rose-600 bg-rose-50' : 
                          'text-gray-600 bg-gray-50';
        
        return (
          <div key={tf} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg ${colorClass}`}>
            <span className="font-bold w-6">{tfLabels[tf]}</span>
            <span className="flex-1">{desc}</span>
          </div>
        );
      })}
    </div>
  );
}

function KeyLevels({ keyLevels }) {
  if (!keyLevels) return null;
  
  const [expanded, setExpanded] = useState(false);
  
  const sections = [
    { key: 'liquidity', icon: Target, label: 'Liquidity', color: 'text-blue-600', bg: 'bg-blue-50' },
    { key: 'order_blocks', icon: Layers, label: 'Order Blocks', color: 'text-purple-600', bg: 'bg-purple-50' },
    { key: 'fvg', icon: Zap, label: 'FVG (Imbalance)', color: 'text-amber-600', bg: 'bg-amber-50' }
  ];
  
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors"
      >
        <span>Key Levels (ICT)</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-2">
          {sections.map(({ key, icon: Icon, label, color, bg }) => {
            const value = keyLevels[key];
            if (!value || value === 'not identified') return null;
            
            return (
              <div key={key} className={`flex items-start gap-2 text-xs p-2 rounded-lg ${bg}`}>
                <Icon size={14} className={`mt-0.5 ${color}`} />
                <div>
                  <span className={`font-semibold ${color}`}>{label}:</span>
                  <span className="text-gray-700 ml-1">{value}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Narrative({ narrative, bias }) {
  if (!narrative) return null;
  
  const biasCfg = biasConfig[bias] || biasConfig.neutral;
  
  return (
    <div className={`p-3 rounded-lg ${biasCfg.bgColor} border ${biasCfg.borderColor || 'border-gray-200'}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${biasCfg.color}`} />
        <span className={`text-xs font-bold uppercase ${biasCfg.textColor}`}>
          {biasCfg.text} BIAS
        </span>
      </div>
      <p className="text-sm text-gray-700 leading-relaxed">{narrative}</p>
    </div>
  );
}

export function CryptoCard({ name, symbol, data, analysis }) {
  const price = data?.price || 0;
  const change24h = data?.change24h || 0;
  const sparkline = data?.sparkline7d || [];
  
  // ICT analysis fields
  const action = analysis?.action || 'hold';
  const bias = analysis?.bias || 'neutral';
  const confidence = analysis?.confidence || 0;
  const narrative = analysis?.narrative;
  const timeframes = analysis?.timeframes;
  const keyLevels = analysis?.key_levels;
  const riskNotes = analysis?.risk;
  
  const config = actionConfig[action] || actionConfig.hold;
  const biasCfg = biasConfig[bias] || biasConfig.neutral;
  const Icon = config.icon;
  const isPositive = change24h >= 0;

  // Mini sparkline
  const miniSparkline = sparkline.slice(-20);
  const sparklineTrend = miniSparkline.length > 1 
    ? miniSparkline[miniSparkline.length - 1] - miniSparkline[0]
    : 0;

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg ${
            symbol === 'BTC' ? 'bg-orange-500' : 'bg-blue-500'
          }`}>
            {symbol}
          </div>
          <div>
            <h3 className="font-bold text-lg text-gray-900">{name}</h3>
            <p className="text-sm text-gray-500">{symbol}/USD</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`px-3 py-1 rounded-full text-xs font-bold ${config.bgColor} ${config.textColor} border ${config.borderColor}`}>
            {config.text}
          </div>
          <div className={`px-2 py-0.5 rounded text-xs font-medium ${biasCfg.bgColor} ${biasCfg.textColor}`}>
            {biasCfg.text}
          </div>
        </div>
      </div>

      {/* Price */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-gray-900">
            ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className={`flex items-center gap-1 mt-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
          {isPositive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          <span className="font-semibold">{Math.abs(change24h).toFixed(2)}%</span>
          <span className="text-gray-500 text-sm ml-1">(24h)</span>
        </div>
      </div>

      {/* Mini Sparkline */}
      {miniSparkline.length > 1 && (
        <div className="mb-4 h-12">
          <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`gradient-${symbol}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={sparklineTrend >= 0 ? '#22c55e' : '#ef4444'} stopOpacity="0.3" />
                <stop offset="100%" stopColor={sparklineTrend >= 0 ? '#22c55e' : '#ef4444'} stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <path
              d={`M 0,${40 - ((miniSparkline[0] - Math.min(...miniSparkline)) / (Math.max(...miniSparkline) - Math.min(...miniSparkline) || 1)) * 40} ${
                miniSparkline.map((val, i) => {
                  const min = Math.min(...miniSparkline);
                  const max = Math.max(...miniSparkline);
                  const range = max - min || 1;
                  const y = 40 - ((val - min) / range) * 40;
                  return `L ${(i / (miniSparkline.length - 1)) * 100},${y}`;
                }).join(' ')
              }`}
              fill="none"
              stroke={sparklineTrend >= 0 ? '#22c55e' : '#ef4444'}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={`M 0,${40 - ((miniSparkline[0] - Math.min(...miniSparkline)) / (Math.max(...miniSparkline) - Math.min(...miniSparkline) || 1)) * 40} ${
                miniSparkline.map((val, i) => {
                  const min = Math.min(...miniSparkline);
                  const max = Math.max(...miniSparkline);
                  const range = max - min || 1;
                  const y = 40 - ((val - min) / range) * 40;
                  return `L ${(i / (miniSparkline.length - 1)) * 100},${y}`;
                }).join(' ')
              } L 100,40 L 0,40 Z`}
              fill={`url(#gradient-${symbol})`}
              stroke="none"
            />
          </svg>
        </div>
      )}

      {/* ICT Analysis Section */}
      <div className={`p-4 rounded-xl ${config.bgColor} border ${config.borderColor}`}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <Icon size={18} className={config.textColor} />
          <span className={`font-semibold ${config.textColor}`}>ICT Smart Money Analysis</span>
        </div>
        
        {/* Narrative */}
        {narrative && <Narrative narrative={narrative} bias={bias} />}
        
        {/* Confidence Bar */}
        <ConfidenceBar confidence={confidence} colorClass={config.barColor} />
        
        {/* Timeframe Structure */}
        {timeframes && <TimeframeStructure timeframes={timeframes} />}
        
        {/* Key Levels (Collapsible) */}
        {keyLevels && <KeyLevels keyLevels={keyLevels} />}
      </div>

      {/* Risk Note */}
      {riskNotes && (
        <div className="flex items-start gap-2 mt-3 text-xs text-gray-500 bg-gray-50 p-2 rounded-lg">
          <Shield size={14} className="mt-0.5 flex-shrink-0" />
          <span>{riskNotes}</span>
        </div>
      )}
    </div>
  );
}
