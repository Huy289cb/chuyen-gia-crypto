'use client';

import {
  BookOpen,
  Layers,
  Shield,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { SectionHeader } from '../components/SectionHeader';
import { SignalGateGradingSection } from './SignalGateGradingSection';

export type RulesLanguage = 'vi' | 'en';

const copy = {
  vi: {
    architecture: {
      title: 'Kiến trúc 4 lớp',
      subtitle: 'Mỗi lớp có vai trò riêng — không bỏ qua bước',
      layers: [
        {
          name: 'Signal Gate',
          desc: 'Lọc setup bằng code (không LLM). Chỉ setup đủ điều kiện mới gọi Groq.',
          tag: 'Không LLM',
        },
        {
          name: 'Risk Engine',
          desc: 'Cổng cứng: daily loss, chuỗi lỗ, spread/slippage, giới hạn vị thế.',
          tag: 'Bắt buộc',
        },
        {
          name: 'LLM Dispatch (Groq)',
          desc: 'Chỉ chạy khi Signal Gate PASS. JSON có cấu trúc, retry tối đa 1 lần.',
          tag: 'Có chọn lọc',
        },
        {
          name: 'Memory Layer',
          desc: 'Lưu quyết định, kết quả, playbook stats — tiêm ngữ cảnh ngắn vào prompt.',
          tag: 'Học từ lịch sử',
        },
      ],
    },
    pipeline: {
      title: 'Decision Pipeline (từng bước)',
      subtitle: 'Khớp với panel Decision Pipeline trên Dashboard',
      steps: [
        { n: 1, name: 'System Ready', desc: 'Worker healthy, DB OK, safety validation passed, không bị lock.' },
        { n: 2, name: 'Candle Warmup Ready', desc: 'Đủ nến BTC: 5m (2000), 15m (1000), 1h (500) trong DB.' },
        { n: 3, name: 'Market Setup Detected', desc: 'MarketScan tìm playbook (liquidity sweep / breakout volume).' },
        { n: 4, name: 'Signal Gate Passed', desc: 'Grade/confidence theo env (MIN_SIGNAL_GRADE, MIN_SIGNAL_CONFIDENCE); regime trend hoặc range (không chop).' },
        { n: 5, name: 'Risk Approved', desc: 'Risk engine unlocked, chưa chạm daily loss cap.' },
        { n: 6, name: 'LLM Dispatch Triggered', desc: 'Groq phân tích với memory context; bias/action phải nhất quán.' },
        { n: 7, name: 'Position Created', desc: 'Lệnh limit Binance Futures → fill WS → position + SL/TP trên sàn (không chỉ local DB).' },
        { n: 8, name: 'Position Monitor Active', desc: 'Mỗi phút: defer exchange SL/TP; profit-protect (BE/trail); invalidation (tighten BE khi structure gãy + green). REDUCE/EXIT mặc định tắt.' },
      ],
    },
    schedulers: {
      title: 'Worker & Lịch chạy',
      subtitle: 'Chỉ worker leader mới chạy scheduler (PostgreSQL advisory lock)',
      rows: [
        { name: 'MarketScan', cron: '*/5 * * * *', role: 'Lấy 5m/15m/1h song song, Signal Gate, cache; lastRun từ worker heartbeat.' },
        { name: 'LLMDispatch', cron: '1,6,11,16,21,26,31,36,41,46,51,56 * * * *', role: 'Best-of 1 TF PASS/cycle; Groq + reconcile R:R từ giá entry/SL/TP.' },
        { name: 'PositionMonitor', cron: '*/1 * * * *', role: 'Profit-protect + invalidation amend SL; WS đóng khi SL/TP fill. REDUCE/EXIT off mặc định.' },
        { name: 'Price sync', cron: '~30s', role: 'Cập nhật giá BTC cho chart và risk.' },
      ],
    },
    phases: [
      {
        id: 'p1',
        title: 'Bước 1 — Đơn giản hóa chiến lược',
        items: [
          'Chỉ BTCUSDT perpetual; ETH và ICT method tắt.',
          'Method hoạt động: Kim Nghia (SMC + Volume + Fibonacci).',
          'Playbook tối đa 2: Liquidity Sweep + Reclaim; Breakout + Volume.',
          'Setup chấm A/B/C/D — ngưỡng tối thiểu từ env (ví dụ MIN_SIGNAL_GRADE=B).',
        ],
      },
      {
        id: 'p2',
        title: 'Bước 2 — Signal Gate (trước LLM)',
        items: [
          'MarketScan đánh giá 5m, 15m, 1h song song — không gọi Groq ở bước này.',
          'LLM chỉ chọn 1 timeframe tốt nhất mỗi chu kỳ (best-of ranking).',
          'Duplicate filter: cùng nến (hash) trong 15 phút → skip, không gọi LLM.',
          'Không PASS → no_trade (lý do lưu memory), không tốn token Groq.',
        ],
      },
      {
        id: 'p3',
        title: 'Bước 3 — Risk Engine',
        items: [
          'Risk mỗi lệnh: ~1% tài khoản (cấu hình env).',
          'Daily loss cap: ~2% — khóa giao dịch khi đạt.',
          'Tối đa 3 lỗ liên tiếp → cooldown 4 giờ.',
          'Lọc spread / slippage / phí trước khi mở lệnh.',
        ],
      },
      {
        id: 'p4',
        title: 'Bước 4 — LLM Dispatch (Groq)',
        items: [
          'Chỉ chạy khi Signal Gate PASS (best-of 5m/15m/1h).',
          'Prompt v3: JSON `{ "btc": { ... } }`; expected_rr được tính lại từ entry/SL/TP.',
          'Validate: bias/action khớp; SL/TP đúng hướng; R:R tối thiểu từ risk policy.',
          'Thất bại parse/validate → NO_TRADE (không retry vô hạn).',
          'Confidence LLM ≥ 82% mới xem xét entry (Kim Nghia prompt).',
        ],
      },
      {
        id: 'p5',
        title: 'Bước 5 — Memory Layer',
        items: [
          'Lưu trade_decision: grade, playbook, regime, lý do no_trade.',
          'Lưu trade_outcome & trade_reflection sau khi đóng lệnh.',
          'playbook_stats: win rate theo setup.',
          'Groq chỉ nhận ~3 setup tương tự + 2 failure gần nhất — không dump full history.',
        ],
      },
      {
        id: 'p6',
        title: 'Bước 6 — Quản lý vị thế (đơn giản)',
        items: [
          'Exchange SL/TP là hard exit; profit-protect: BE @ 1R, trail, time-stop BE.',
          'Invalidation Phase A: structure adverse + green → tighten SL to BE (không market-exit).',
          'Binance WS: SL/TP fill → đóng position local; ACCOUNT_UPDATE sync.',
          'Exposure cap: MAX_TOTAL_EXPOSURE_USD (mở + pending).',
          'REDUCE/EXIT health actions mặc định tắt (ALLOW_REDUCE/EXIT=false).',
        ],
      },
      {
        id: 'p7',
        title: 'Bước 7 — Dashboard v3',
        items: [
          'Decision Pipeline, Candle Warmup, Signal Gate, Risk, LLM, Memory, Event Log.',
          'Live Account: balance, positions, orders, trade history (Binance mainnet).',
          'No-Trade Reasons: tổng hợp lý do skip (duplicate, gate, LLM, risk).',
          'Market chart: nến + SMA/RSI/ATR từ API /market.',
        ],
      },
    ],
    disabled: {
      title: 'Đã tắt (Legacy — không còn trong v3)',
      items: [
        'POST /api/analysis/run và kim_nghia auto-entry cron cũ.',
        'ICT method (method_id: ict) — disabled.',
        'Giao dịch ETH / multi-symbol auto-entry.',
        'Gọi Groq mỗi 15 phút bất kể setup.',
        'Paper Account legacy — sổ lệnh vẫn dùng bảng Testnet* + Binance live API.',
        'UI frontend-old (Vite) — thay bằng Next.js dashboard v3.',
      ],
    },
    config: {
      title: 'Cấu hình tham chiếu (production)',
      rows: [
        ['Symbol', 'BTC only'],
        ['Timeframes scan', '5m, 15m, 1h'],
        ['Signal Gate min grade', 'env: MIN_SIGNAL_GRADE (e.g. B)'],
        ['Signal Gate min confidence', 'env: MIN_SIGNAL_CONFIDENCE'],
        ['Max exposure (open+pending)', 'env: MAX_TOTAL_EXPOSURE_USD'],
        ['Allowed regimes', 'trend, range'],
        ['Duplicate cache TTL', '15 phút'],
        ['LLM model', 'Groq (meta-llama / llama family)'],
        ['Prompt version', 'v3'],
        ['Execution', 'Binance Futures Mainnet (limit + SL/TP on exchange)'],
        ['Backend deploy', 'VPS: scripts/deploy.sh'],
        ['Frontend deploy', 'Vercel: git push'],
      ],
    },
    notes: {
      title: 'Lưu ý',
      items: [
        'Đây là môi trường live mainnet — rủi ro tiền thật; không phải tư vấn tài chính.',
        'Panel “LLM invalid JSON” = Groq trả về hoặc validate thất bại; xem Event Log.',
        'Scheduler LLM “idle” là bình thường khi không có setup PASS.',
        'Log đỏ “Previous scan still running” sau deploy: cảnh báo trùng cron, thường vô hại.',
      ],
    },
  },
  en: {
    architecture: {
      title: 'Four-layer architecture',
      subtitle: 'Each layer has a distinct role — no skipped steps',
      layers: [
        {
          name: 'Signal Gate',
          desc: 'Deterministic setup filters (no LLM). Only qualified setups reach Groq.',
          tag: 'No LLM',
        },
        {
          name: 'Risk Engine',
          desc: 'Hard gate: daily loss, loss streak, spread/slippage, position limits.',
          tag: 'Mandatory',
        },
        {
          name: 'LLM Dispatch (Groq)',
          desc: 'Runs only after Signal Gate PASS. Structured JSON, max 1 retry.',
          tag: 'Selective',
        },
        {
          name: 'Memory Layer',
          desc: 'Stores decisions, outcomes, playbook stats — short context in prompts.',
          tag: 'Learning',
        },
      ],
    },
    pipeline: {
      title: 'Decision Pipeline (step by step)',
      subtitle: 'Matches the Decision Pipeline panel on the Dashboard',
      steps: [
        { n: 1, name: 'System Ready', desc: 'Worker healthy, DB OK, safety validation passed, not locked.' },
        { n: 2, name: 'Candle Warmup Ready', desc: 'Enough BTC candles in DB: 5m (2000), 15m (1000), 1h (500).' },
        { n: 3, name: 'Market Setup Detected', desc: 'MarketScan finds a playbook (liquidity sweep / breakout volume).' },
        { n: 4, name: 'Signal Gate Passed', desc: 'Grade/confidence from env (MIN_SIGNAL_GRADE, MIN_SIGNAL_CONFIDENCE); trend or range regime.' },
        { n: 5, name: 'Risk Approved', desc: 'Risk engine unlocked, daily loss cap not hit.' },
        { n: 6, name: 'LLM Dispatch Triggered', desc: 'Groq analyzes with memory context; bias/action must be consistent.' },
        { n: 7, name: 'Position Created', desc: 'Binance Futures limit order → WS fill → position + SL/TP on exchange.' },
        { n: 8, name: 'Position Monitor Active', desc: 'Every minute: defer to exchange SL/TP; profit-protect (BE/trail); invalidation (tighten BE when structure breaks + green). REDUCE/EXIT off by default.' },
      ],
    },
    schedulers: {
      title: 'Worker & schedules',
      subtitle: 'Only the worker leader runs schedulers (PostgreSQL advisory lock)',
      rows: [
        { name: 'MarketScan', cron: '*/5 * * * *', role: 'Parallel 5m/15m/1h fetch, Signal Gate, cache; lastRun from worker heartbeat.' },
        { name: 'LLMDispatch', cron: '1,6,11,16,21,26,31,36,41,46,51,56 * * * *', role: 'Best-of 1 PASS TF/cycle; Groq + R:R reconcile from prices.' },
        { name: 'PositionMonitor', cron: '*/1 * * * *', role: 'Profit-protect + invalidation amend SL; WS closes on SL/TP fill. REDUCE/EXIT off by default.' },
        { name: 'Price sync', cron: '~30s', role: 'Update BTC price for chart and risk.' },
      ],
    },
    phases: [
      {
        id: 'p1',
        title: 'Step 1 — Strategy simplification',
        items: [
          'BTCUSDT perpetual only; ETH and ICT method disabled.',
          'Active method: Kim Nghia (SMC + Volume + Fibonacci).',
          'Max 2 playbooks: Liquidity Sweep + Reclaim; Breakout + Volume.',
          'Setups graded A/B/C/D — minimum from env (e.g. MIN_SIGNAL_GRADE=B).',
        ],
      },
      {
        id: 'p2',
        title: 'Step 2 — Signal Gate (before LLM)',
        items: [
          'MarketScan evaluates 5m, 15m, 1h in parallel — no Groq at this step.',
          'LLM picks one best PASS timeframe per cycle (best-of ranking).',
          'Duplicate filter: same candle hash within 15 min → skip, no LLM call.',
          'No PASS → no_trade (reason stored), no Groq tokens spent.',
        ],
      },
      {
        id: 'p3',
        title: 'Step 3 — Risk Engine',
        items: [
          'Risk per trade: ~1% of account (env config).',
          'Daily loss cap: ~2% — trading locked when hit.',
          'Max 3 consecutive losses → 4 hour cooldown.',
          'Spread / slippage / fee filters before entry.',
        ],
      },
      {
        id: 'p4',
        title: 'Step 4 — LLM Dispatch (Groq)',
        items: [
          'Runs only when Signal Gate PASS (best-of 5m/15m/1h).',
          'Prompt v3: JSON `{ "btc": { ... } }`; expected_rr reconciled from entry/SL/TP.',
          'Validate: bias/action match; SL/TP direction; min R:R from risk policy.',
          'Parse/validate failure → NO_TRADE (no infinite retries).',
          'LLM confidence ≥ 82% required for entry (Kim Nghia prompt).',
        ],
      },
      {
        id: 'p5',
        title: 'Step 5 — Memory Layer',
        items: [
          'Stores trade_decision: grade, playbook, regime, no_trade reason.',
          'Stores trade_outcome & trade_reflection after close.',
          'playbook_stats: win rate per setup.',
          'Groq gets ~3 similar setups + 2 recent failures — not full history.',
        ],
      },
      {
        id: 'p6',
        title: 'Step 6 — Position management (simplified)',
        items: [
          'Exchange SL/TP is the hard exit; profit-protect: BE @ 1R, trail, time-stop BE.',
          'Invalidation Phase A: adverse structure + green → tighten SL to BE (no market exit).',
          'Binance WS: SL/TP fill closes local position; ACCOUNT_UPDATE sync.',
          'Exposure cap: MAX_TOTAL_EXPOSURE_USD (open + pending).',
          'REDUCE/EXIT health actions off by default (ALLOW_REDUCE/EXIT=false).',
        ],
      },
      {
        id: 'p7',
        title: 'Step 7 — Dashboard v3',
        items: [
          'Decision Pipeline, Candle Warmup, Signal Gate, Risk, LLM, Memory, Event Log.',
          'Live Account: balance, positions, orders, trade history (Binance mainnet).',
          'No-Trade Reasons: aggregated skip reasons (duplicate, gate, LLM, risk).',
          'Market chart: candles + SMA/RSI/ATR from /market API.',
        ],
      },
    ],
    disabled: {
      title: 'Disabled (Legacy — not in v3)',
      items: [
        'POST /api/analysis/run and legacy kim_nghia auto-entry cron.',
        'ICT method (method_id: ict) — disabled.',
        'ETH trading / multi-symbol auto-entry.',
        'Groq every 15 minutes regardless of setup.',
        'Legacy Paper Account — bookkeeping still uses Testnet* tables + Binance live API.',
        'frontend-old (Vite) UI — replaced by Next.js v3 dashboard.',
      ],
    },
    config: {
      title: 'Reference configuration (production)',
      rows: [
        ['Symbol', 'BTC only'],
        ['Scan timeframes', '5m, 15m, 1h'],
        ['Signal Gate min grade', 'env: MIN_SIGNAL_GRADE (e.g. B)'],
        ['Signal Gate min confidence', 'env: MIN_SIGNAL_CONFIDENCE'],
        ['Max exposure (open+pending)', 'env: MAX_TOTAL_EXPOSURE_USD'],
        ['Allowed regimes', 'trend, range'],
        ['Duplicate cache TTL', '15 minutes'],
        ['LLM model', 'Groq (meta-llama / llama family)'],
        ['Prompt version', 'v3'],
        ['Execution', 'Binance Futures Mainnet (limit + SL/TP on exchange)'],
        ['Backend deploy', 'VPS: scripts/deploy.sh'],
        ['Frontend deploy', 'Vercel: git push'],
      ],
    },
    notes: {
      title: 'Notes',
      items: [
        'Live mainnet environment — real money risk; not financial advice.',
        '“LLM invalid JSON” panel means Groq response or validation failed; see Event Log.',
        'LLM scheduler “idle” is normal when no setup PASSes the gate.',
        'Red log “Previous scan still running” after deploy: cron overlap warning, usually harmless.',
      ],
    },
  },
} as const;

interface V3RulesProps {
  language: RulesLanguage;
}

export function V3Rules({ language }: V3RulesProps) {
  const t = copy[language];

  return (
    <div className="space-y-10" >
      <section>
        <SectionHeader
          title={t.architecture.title}
          subtitle={t.architecture.subtitle}
          icon={<Layers className="w-5 h-5" />}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {t.architecture.layers.map((layer) => (
            <Card key={layer.name} padding="md">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h4 className="font-semibold text-foreground">{layer.name}</h4>
                <Badge variant="info" size="sm">
                  {layer.tag}
                </Badge>
              </div>
              <p className="text-sm text-foreground-secondary">{layer.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader
          title={t.pipeline.title}
          subtitle={t.pipeline.subtitle}
          icon={<ArrowRight className="w-5 h-5" />}
        />
        <Card padding="md">
          <ol className="space-y-3">
            {t.pipeline.steps.map((step) => (
              <li key={step.n} className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent-primary/20 text-accent-primary text-sm font-bold flex items-center justify-center">
                  {step.n}
                </span>
                <div>
                  <p className="font-medium text-foreground text-sm">{step.name}</p>
                  <p className="text-sm text-foreground-secondary mt-0.5">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <SignalGateGradingSection language={language} />

      <section>
        <SectionHeader
          title={t.schedulers.title}
          subtitle={t.schedulers.subtitle}
          icon={<Clock className="w-5 h-5" />}
        />
        <Card padding="md">
          <div className="space-y-4">
            {t.schedulers.rows.map((row) => (
              <div key={row.name} className="border-b border-border-default last:border-0 pb-4 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-medium text-foreground">{row.name}</span>
                  <code className="text-xs px-2 py-0.5 rounded bg-surface-2 text-foreground-tertiary">
                    {row.cron}
                  </code>
                </div>
                <p className="text-sm text-foreground-secondary">{row.role}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {t.phases.map((phase) => (
        <section key={phase.id}>
          <SectionHeader title={phase.title} icon={<CheckCircle2 className="w-5 h-5" />} />
          <Card padding="md">
            <ul className="space-y-2">
              {phase.items.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-foreground-secondary">
                  <span className="text-accent-primary mt-0.5">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}

      <section>
        <SectionHeader title={t.disabled.title} icon={<Ban className="w-5 h-5 text-danger" />} />
        <Card padding="md" className="border-danger/30 bg-danger/5">
          <ul className="space-y-2">
            {t.disabled.items.map((item) => (
              <li key={item} className="flex gap-2 text-sm text-foreground-secondary">
                <XCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section>
        <SectionHeader title={t.config.title} icon={<BookOpen className="w-5 h-5" />} />
        <Card padding="md">
          <dl className="divide-y divide-border-default">
            {t.config.rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <dt className="text-sm text-foreground-secondary">{label}</dt>
                <dd className="text-sm font-medium text-foreground text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section>
        <SectionHeader title={t.notes.title} icon={<Shield className="w-5 h-5" />} />
        <Card padding="md">
          <ul className="space-y-2">
            {t.notes.items.map((item) => (
              <li key={item} className="text-sm text-foreground-secondary">
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
