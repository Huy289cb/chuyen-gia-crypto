'use client';

import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { Bot, Loader2 } from 'lucide-react';
import { getApiBase } from '../lib/apiBase';
import { Button } from '../components/ui/Button';

type AiScope = 'today_run' | 'errors' | 'pipeline' | 'llm' | 'compare' | 'freeform';

const SCOPE_LABELS: Record<AiScope, string> = {
  today_run: 'Run hôm nay',
  errors: 'Lỗi gần đây',
  pipeline: 'Pipeline',
  llm: 'LLM hôm nay',
  compare: 'So sánh 7 ngày',
  freeform: 'Hỏi tự do',
};

interface TelegramAiPanelProps {
  className?: string;
}

export function TelegramAiPanel({ className }: TelegramAiPanelProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [scope, setScope] = useState<AiScope>('today_run');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const res = await fetch(`${getApiBase()}/dashboard/telegram-ai/status`);
      const json = (await res.json()) as { success?: boolean; data?: { enabled?: boolean } };
      setEnabled(json.data?.enabled ?? false);
    } catch {
      setEnabled(false);
    }
  };

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch(`${getApiBase()}/dashboard/telegram-ai/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          question: scope === 'freeform' ? question : undefined,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { answer?: string };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Query failed');
      }
      setAnswer(json.data?.answer ?? '(empty)');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  };

  if (enabled === null) {
    void loadStatus();
    return (
      <Card className={className}>
        <SectionHeader title="Telegram AI" subtitle="Đang kiểm tra..." icon={<Bot className="w-5 h-5" />} />
      </Card>
    );
  }

  if (!enabled) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Telegram AI"
          subtitle="TELEGRAM_AI_ENABLED=false trên backend"
          icon={<Bot className="w-5 h-5" />}
        />
        <p className="p-4 text-sm text-foreground-secondary">
          Bật AI trên worker VPS để dùng panel này hoặc lệnh /ai trên Telegram.
        </p>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <SectionHeader
        title="Telegram AI"
        subtitle="Mirror /ai qua Groq + DB context"
        icon={<Bot className="w-5 h-5" />}
      />

      <div className="p-4 space-y-4">
        <div>
          <label className="text-xs text-foreground-tertiary block mb-1">Scope</label>
          <select
            className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value as AiScope)}
          >
            {(Object.keys(SCOPE_LABELS) as AiScope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {scope === 'freeform' ? (
          <div>
            <label className="text-xs text-foreground-tertiary block mb-1">Câu hỏi</label>
            <textarea
              className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-sm min-h-[80px]"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="VD: Tại sao không có lệnh hôm nay?"
            />
          </div>
        ) : null}

        <Button onClick={() => void runQuery()} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2 inline" />
              Đang phân tích...
            </>
          ) : (
            'Phân tích'
          )}
        </Button>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        {answer ? (
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-2">Kết quả</p>
            <pre className="text-sm whitespace-pre-wrap text-foreground font-sans">{answer}</pre>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
