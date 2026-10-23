'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Play, RefreshCw, Wallet } from 'lucide-react';
import { Card, CardHeader } from './ui/Card';
import { Button } from './ui/Button';
import { MetricCard } from './MetricCard';
import { PanelErrorState } from './PanelErrorState';
import { getApiBase } from '../lib/apiBase';
import { cn } from '@/lib/utils';

type RecordValue = Record<string, unknown>;
type PaperJob = { status: 'running' | 'complete' | 'failed'; id?: string; startedAt?: string; error?: string };
type PaperData = {
  mode: 'paper';
  policy: { initialBalance: number; dailyLossLimit: number; timezone: string };
  state: RecordValue | null;
  summary: RecordValue | null;
  latestTestbed: RecordValue | null;
  testbedJob: PaperJob | null;
  enabled: boolean;
  worker?: RecordValue | null;
  updatedAt?: string;
  config: RecordValue;
  testbed?: { request?: RecordValue; label?: string; available?: boolean };
};

function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function numeric(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown, signed = false): string {
  const n = numeric(value);
  return n === null ? 'Chưa có dữ liệu' : `${signed && n > 0 ? '+' : ''}${n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`;
}

function quantity(value: unknown): string {
  const n = numeric(value);
  return n === null ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: 8 });
}

function moment(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return 'Chưa có dữ liệu';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Chưa có dữ liệu' : date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function rows(value: unknown): RecordValue[] {
  if (Array.isArray(value)) return value.map(object).filter((x): x is RecordValue => x !== null);
  const entries = object(value);
  return entries ? Object.entries(entries).map(([symbol, item]) => ({ symbol, ...object(item) })) : [];
}

function text(value: unknown, fallback = '—'): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

async function request(path: string, method: 'GET' | 'POST', signal?: AbortSignal, body?: RecordValue): Promise<RecordValue> {
  const response = await fetch(`${getApiBase()}/portfolio-paper${path}`, {
    method,
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    signal,
  });
  const payload: unknown = await response.json();
  const result = object(payload);
  if (!response.ok || !result || result.success !== true) {
    throw new Error(text(result?.error ?? result?.message, `Không lấy được dữ liệu paper (HTTP ${response.status}).`));
  }
  const data = object(result.data);
  if (!data) throw new Error('Phản hồi paper chưa có dữ liệu hợp lệ.');
  return data;
}

export function FuturesPortfolioPaperPanel() {
  const [data, setData] = useState<PaperData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'testbed' | 'advance' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const snapshot = await request('', 'GET', controller.signal);
      if (snapshot.mode !== 'paper' || !object(snapshot.policy)) throw new Error('Endpoint chưa trả đúng chế độ mô phỏng.');
      if (mounted.current) {
        setData(snapshot as unknown as PaperData);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Không lấy được trạng thái paper.');
    } finally {
      window.clearTimeout(timeout);
      refreshing.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = window.setInterval(() => { void refresh(); }, 5000);
    return () => {
      mounted.current = false;
      window.clearInterval(poll);
      activeRequest.current?.abort();
    };
  }, [refresh]);

  const run = async (kind: 'testbed' | 'advance') => {
    setAction(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await request(`/${kind}`, 'POST', undefined, kind === 'testbed' ? data?.testbed?.request ?? { days: 14 } : {});
      if (!mounted.current) return;
      setNotice(result.status === 'running'
        ? 'Đang chạy mô phỏng đã đăng ký. Kết quả sẽ cập nhật khi hoàn tất.'
        : 'Đã xử lý phiên mô phỏng. Đang cập nhật số liệu.');
      await refresh();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Không nhận được phản hồi. Cập nhật trạng thái trước khi thử lại.');
      await refresh();
    } finally {
      if (mounted.current) setAction(null);
    }
  };

  const state = data?.state;
  const summary = data?.summary;
  const job = data?.testbedJob;
  const jobRunning = job?.status === 'running';
  const busy = action !== null || jobRunning;
  const liveQuoteStale = data?.worker?.status === 'degraded' || Boolean(data?.updatedAt && Date.now() - Date.parse(data.updatedAt) > 180000);
  const positions = rows(state?.positions);
  const weights = object(state?.targetWeights);
  const targetQuantities = object(state?.targetQuantities);
  const marks = object(state?.marks);
  const currentDay = object(state?.currentDay);
  const ledger = [...rows(state?.days), ...(currentDay ? [currentDay] : [])];
  const positionBySymbol = new Map(positions.map(position => [text(position.symbol), position]));
  const symbols = Array.from(new Set([...positionBySymbol.keys(), ...Object.keys(weights ?? {}), ...Object.keys(targetQuantities ?? {})])).sort();
  const testbed = data?.latestTestbed;
  const cases = rows(testbed?.cases);
  const period = object(testbed?.period);
  const limitations = Array.isArray(testbed?.limitations) ? testbed.limitations.filter((x): x is string => typeof x === 'string') : [];
  const netPnl = numeric(summary?.netPnl);
  const equity = numeric(state?.equity);
  let netNotional: number | null = state ? 0 : null;
  let trackingError: number | null = state && weights && equity !== null ? 0 : null;
  for (const symbol of symbols) {
    const position = positionBySymbol.get(symbol);
    const q = position ? numeric(position.quantity) : 0;
    const mark = numeric(marks?.[symbol]);
    const weight = numeric(weights?.[symbol]);
    if (q === null || (q !== 0 && mark === null)) {
      netNotional = null;
      trackingError = null;
      continue;
    }
    const notional = q === 0 ? 0 : q * (mark as number);
    if (netNotional !== null) netNotional += notional;
    if (trackingError !== null && equity !== null) {
      if (weight === null) trackingError = null;
      else trackingError += Math.abs(notional - weight * equity);
    }
  }
  const dayPnl = numeric(currentDay?.netPnl);
  const limit = numeric(data?.policy.dailyLossLimit);
  const strategyLabel = text(data?.config.displayName, 'Danh mục Futures');
  const testbedLabel = data?.testbed?.label ?? 'Mô phỏng đã đăng ký';
  const remainingDailyLoss = dayPnl !== null && limit !== null ? Math.max(0, limit + dayPnl) : null;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <span className="inline-block rounded-md bg-accent-primary/10 text-accent-primary px-2 py-1 text-xs font-medium">MÔ PHỎNG · GIÁ THỊ TRƯỜNG CÔNG KHAI</span>
            <p className="text-sm text-foreground-secondary">Lệnh và số dư ở đây được mô phỏng. Kết quả lịch sử chưa xác nhận thu nhập tương lai.</p>
            <p className="text-sm text-foreground">{strategyLabel}{data?.config.sourceScalar ? ` · sizing ${text(data.config.sourceScalar)} · reserve ${text(data.config.closeBufferUsd)} USDT` : ''}</p>
            <p className="text-xs text-foreground-tertiary">Cập nhật: {moment(data?.updatedAt)} · Giờ Việt Nam</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { void refresh(); }} disabled={loading} leftIcon={<RefreshCw className="w-4 h-4" aria-hidden />}>Cập nhật</Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => { void run('testbed'); }} disabled={busy || loading || !data || data.testbed?.available === false} isLoading={action === 'testbed' || jobRunning} leftIcon={<Play className="w-4 h-4" aria-hidden />}>Chạy {testbedLabel}</Button>
          <Button variant="secondary" onClick={() => { void run('advance'); }} disabled={busy || loading || !data?.enabled || liveQuoteStale} isLoading={action === 'advance'}>Chạy phiên với giá hiện tại</Button>
        </div>
        {liveQuoteStale && <p className="mt-3 text-xs text-warning">Giá đang chậm; chưa mở thêm vị thế từ trang này. Testbed lịch sử vẫn dùng được.</p>}
        {data && !data.enabled && <p className="mt-3 text-xs text-foreground-tertiary">Phiên paper theo giá hiện tại chưa được bật.</p>}
        {data?.testbed?.available === false && <p className="mt-3 text-xs text-foreground-tertiary">Kỳ mô phỏng này chưa được đăng ký.</p>}
        {job && <p className="mt-3 text-sm text-foreground-secondary" role="status">{testbedLabel}: {job.status === 'running' ? 'đang chạy' : job.status === 'complete' ? 'đã hoàn tất' : 'thất bại'}{job.startedAt ? ` · bắt đầu ${moment(job.startedAt)}` : ''}</p>}
        {notice && <p className="mt-3 text-sm text-foreground-secondary" role="status">{notice}</p>}
      </Card>

      {error && <PanelErrorState message={error} />}
      {job?.status === 'failed' && job.error && <PanelErrorState message={job.error} />}
      {loading && <p className="text-sm text-foreground-tertiary" role="status">Đang lấy dữ liệu mô phỏng…</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Vốn ban đầu dùng chung" value={money(data?.policy.initialBalance)} icon={<Wallet className="w-4 h-4" />} size="sm" />
        <MetricCard title="Lỗ tối đa mỗi ngày ICT" value={money(data?.policy.dailyLossLimit)} footnote="Cố định cho toàn danh mục" size="sm" />
        <MetricCard title="Equity mô phỏng" value={money(summary?.equity)} size="sm" />
        <MetricCard title="Lãi/lỗ ròng mô phỏng" value={money(summary?.netPnl, true)} trend={netPnl === null ? 'neutral' : netPnl >= 0 ? 'up' : 'down'} size="sm" />
      </div>

      <Card>
        <CardHeader title="Ví chung và chi phí" subtitle="Phí và funding đã nằm trong lãi/lỗ ròng khi có dữ liệu." />
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <Detail label="Phí giao dịch" value={money(summary?.totalFees)} />
          <Detail label="Funding PnL có dấu" value={money(summary?.fundingPnl, true)} />
          <Detail label="Trượt giá mô phỏng" value={money(summary?.slippage)} />
          <Detail label="Bình quân mỗi ngày lịch" value={money(summary?.meanNetPerCalendarDay, true)} />
          <Detail label="Lãi/lỗ ngày hiện tại ICT" value={money(currentDay?.netPnl, true)} />
          <Detail label="Khoảng cách đến mức −10u hôm nay" value={money(remainingDailyLoss)} />
          <Detail label="Tổng exposure" value={money(summary?.grossNotional)} />
          <Detail label="Chênh long trừ short" value={money(netNotional, true)} />
        </dl>
        {currentDay?.riskLatched === true && <p className="mt-4 text-sm text-warning">Đã khóa tăng vị thế trong ngày này: {text(currentDay.latchReason)}.</p>}
      </Card>

      <Card>
        <CardHeader title={`Kết quả ${testbedLabel}`} subtitle="Hai mức chi phí: cơ sở và trượt giá cao. Bình quân gồm mọi ngày lịch, cả ngày không giao dịch." icon={<Clock className="w-4 h-4" />} />
        {period && <p className="mb-4 text-sm text-foreground-secondary">{moment(period.start)} → {moment(period.end)} · {text(period.days)} ngày lịch</p>}
        {cases.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <caption className="sr-only">Lợi nhuận và chi phí của kỳ mô phỏng đã đăng ký</caption>
              <thead className="text-foreground-tertiary border-b border-border-default"><tr><th className="py-2 pr-4" scope="col">Chi phí</th><th className="py-2 pr-4" scope="col">Net PnL</th><th className="py-2 pr-4" scope="col">Net / ngày lịch</th><th className="py-2 pr-4" scope="col">Phí</th><th className="py-2 pr-4" scope="col">Funding</th><th className="py-2 pr-4" scope="col">Slip</th><th className="py-2 pr-4" scope="col">Ngày xấu nhất</th><th className="py-2 pr-4" scope="col">Vượt 10u/ngày</th><th className="py-2" scope="col">Fills</th></tr></thead>
              <tbody className="text-foreground">
                {cases.map((item, i) => <tr key={text(item.name, String(i))} className="border-b border-border-default/60 last:border-0"><th className="py-3 pr-4 font-medium" scope="row">{item.name === 'base' ? 'Cơ sở' : item.name === 'stress' ? 'Trượt giá cao' : text(item.name)}</th><td className="py-3 pr-4 font-mono">{money(item.netPnl, true)}</td><td className="py-3 pr-4 font-mono">{money(item.meanDailyPnl, true)}</td><td className="py-3 pr-4">{money(item.fees)}</td><td className="py-3 pr-4">{money(item.funding, true)}</td><td className="py-3 pr-4">{money(item.slippage)}</td><td className="py-3 pr-4">{money(item.worstDay, true)}</td><td className="py-3 pr-4">{text(item.budgetBreaches, 'Chưa đo')}</td><td className="py-3">{text(item.fills, 'Chưa đo')}</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-foreground-tertiary">Chưa có kết quả cho kỳ mô phỏng này.</p>}
        {limitations.length > 0 && <ul className="mt-4 space-y-1 list-disc pl-5 text-xs text-foreground-tertiary">{limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
      </Card>

      <Card>
        <CardHeader title="Vị thế mục tiêu và vị thế mô phỏng" subtitle="Đối chiếu phân bổ nguồn với lượng thực thi sau lot/minimum và giới hạn tài khoản." />
        <p className="mb-4 text-sm text-foreground-secondary">Sai lệch tuyệt đối so với weights nguồn ở equity hiện tại: {money(trackingError)}</p>
        {symbols.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm text-left whitespace-nowrap"><caption className="sr-only">Danh mục mục tiêu và danh mục mô phỏng</caption><thead className="text-foreground-tertiary border-b border-border-default"><tr><th className="py-2 pr-4" scope="col">Coin</th><th className="py-2 pr-4" scope="col">Weight nguồn</th><th className="py-2 pr-4" scope="col">Quantity mục tiêu sau lot</th><th className="py-2 pr-4" scope="col">Quantity đang giữ</th><th className="py-2 pr-4" scope="col">Vị thế có dấu</th><th className="py-2" scope="col">Giá mark</th></tr></thead><tbody className="text-foreground">{symbols.map(symbol => {
            const position = positionBySymbol.get(symbol);
            const weight = numeric(weights?.[symbol]);
            const q = position ? numeric(position.quantity) : 0;
            const mark = numeric(marks?.[symbol]);
            const actual = q === 0 ? 0 : q !== null && mark !== null ? q * mark : null;
            return <tr key={symbol} className="border-b border-border-default/60 last:border-0"><th className="py-2.5 pr-4 font-medium" scope="row">{symbol}</th><td className="py-2.5 pr-4 font-mono">{weight === null ? '—' : `${quantity(weight * 100)}%`}</td><td className="py-2.5 pr-4 font-mono">{quantity(targetQuantities?.[symbol])}</td><td className="py-2.5 pr-4 font-mono">{quantity(q)}</td><td className="py-2.5 pr-4 font-mono">{money(actual, true)}</td><td className="py-2.5 font-mono">{quantity(mark)}</td></tr>;
          })}</tbody></table></div>
        ) : <p className="text-sm text-foreground-tertiary">Chưa có vị thế hoặc mục tiêu đã ghi nhận.</p>}
      </Card>

      <Card>
        <CardHeader title="Sổ ngày Việt Nam" subtitle="Lãi/lỗ theo equity toàn ví; gồm ngày không có lệnh." />
        {ledger.length ? <div className="overflow-x-auto"><table className="w-full text-sm text-left whitespace-nowrap"><caption className="sr-only">Sổ lãi/lỗ theo ngày ICT</caption><thead className="text-foreground-tertiary border-b border-border-default"><tr><th className="py-2 pr-4" scope="col">Ngày ICT</th><th className="py-2 pr-4" scope="col">Equity đầu ngày</th><th className="py-2 pr-4" scope="col">Equity cuối/ngay hiện tại</th><th className="py-2 pr-4" scope="col">Net PnL</th><th className="py-2" scope="col">Vượt ngân sách</th></tr></thead><tbody>{ledger.map((day, i) => <tr key={text(day.day, String(i))} className="border-b border-border-default/60 last:border-0"><th className="py-2.5 pr-4 font-medium text-foreground" scope="row">{text(day.day)}</th><td className="py-2.5 pr-4 font-mono text-foreground">{money(day.anchorEquity)}</td><td className="py-2.5 pr-4 font-mono text-foreground">{money(day.endEquity)}</td><td className={cn('py-2.5 pr-4 font-mono', numeric(day.netPnl) === null ? 'text-foreground-tertiary' : Number(day.netPnl) >= 0 ? 'text-success' : 'text-danger')}>{money(day.netPnl, true)}</td><td className="py-2.5 text-foreground-secondary">{day.anchorQuality === 'missing_midnight' || numeric(day.breachUsd) === null ? 'Thiếu mốc 00:00' : Number(day.breachUsd) > 0 ? `Có: ${money(day.breachUsd)}` : 'Không trong mô hình'}</td></tr>)}</tbody></table></div> : <p className="text-sm text-foreground-tertiary">Chưa có ngày mô phỏng đã ghi nhận.</p>}
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="space-y-1"><dt className="text-foreground-tertiary text-xs">{label}</dt><dd className="text-foreground font-mono break-words">{value}</dd></div>;
}
