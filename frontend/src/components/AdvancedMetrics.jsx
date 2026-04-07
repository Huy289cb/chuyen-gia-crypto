import { useState, useEffect } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity, Target, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const API_BASE = import.meta.env.API_URL || 'http://localhost:3000/api';

export function AdvancedMetrics({ symbol }) {
  const [accuracyTimeframe, setAccuracyTimeframe] = useState({});
  const [accuracyBias, setAccuracyBias] = useState({});
  const [holdTime, setHoldTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch accuracy by timeframe
        const tfRes = await fetch(`${API_BASE}/performance/accuracy-timeframe?symbol=${symbol}`);
        const tfData = await tfRes.json();
        if (tfData.success) {
          setAccuracyTimeframe(tfData.data);
        }

        // Fetch accuracy by bias
        const biasRes = await fetch(`${API_BASE}/performance/accuracy-bias?symbol=${symbol}`);
        const biasData = await biasRes.json();
        if (biasData.success) {
          setAccuracyBias(biasData.data);
        }

        // Fetch hold time
        const holdRes = await fetch(`${API_BASE}/performance/hold-time?symbol=${symbol}`);
        const holdData = await holdRes.json();
        if (holdData.success) {
          setHoldTime(holdData.data);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [symbol]);

  // Prepare accuracy by timeframe data for chart
  const tfChartData = Object.entries(accuracyTimeframe).map(([tf, data]) => ({
    name: tf,
    accuracy: (data.accuracy * 100).toFixed(1),
    total: data.total
  }));

  // Prepare accuracy by bias data for pie chart
  const biasChartData = Object.entries(accuracyBias).map(([bias, data]) => ({
    name: bias,
    value: data.total,
    accuracy: (data.accuracy * 100).toFixed(1)
  }));

  const biasColors = {
    bullish: '#10b981',
    bearish: '#ef4444',
    neutral: '#6b7280'
  };

  const biasIcons = {
    bullish: TrendingUp,
    bearish: TrendingDown,
    neutral: Minus
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-500">Đang tải advanced metrics...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
        <div className="flex items-center justify-center py-8">
          <div className="text-rose-600">Lỗi: {error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-900">Advanced Metrics - {symbol}</h3>
      </div>

      <div className="space-y-6">
        {/* Accuracy by Timeframe */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Target size={16} />
            Accuracy by Timeframe
          </h4>
          {tfChartData.length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tfChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="accuracy" name="Accuracy (%)" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">Chưa có dữ liệu</div>
          )}
        </div>

        {/* Accuracy by Bias */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Activity size={16} />
            Accuracy by Bias
          </h4>
          {biasChartData.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={biasChartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {biasChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={biasColors[entry.name] || '#8884d8'} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {Object.entries(accuracyBias).map(([bias, data]) => {
                  const BiasIcon = biasIcons[bias] || Minus;
                  return (
                    <div key={bias} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <BiasIcon size={16} className={bias === 'bullish' ? 'text-emerald-600' : bias === 'bearish' ? 'text-rose-600' : 'text-gray-600'} />
                        <span className="text-sm font-medium text-gray-700 capitalize">{bias}</span>
                      </div>
                      <div className="text-sm">
                        <span className="font-bold text-gray-900">{(data.accuracy * 100).toFixed(0)}%</span>
                        <span className="text-gray-500 ml-1">({data.total} trades)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">Chưa có dữ liệu</div>
          )}
        </div>

        {/* Average Hold Time */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Clock size={16} />
            Average Hold Time
          </h4>
          {holdTime ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-gray-50 rounded-xl">
                <div className="text-xs text-gray-600 mb-1">Trung bình</div>
                <div className="text-lg font-bold text-gray-900">{holdTime.averageMinutes}p</div>
                <div className="text-xs text-gray-500">{holdTime.averageHours}h</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl">
                <div className="text-xs text-gray-600 mb-1">Trung vị</div>
                <div className="text-lg font-bold text-gray-900">{holdTime.medianMinutes}p</div>
                <div className="text-xs text-gray-500">median</div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">Chưa có dữ liệu</div>
          )}
        </div>
      </div>
    </div>
  );
}
