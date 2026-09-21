'use client';
import type { Decision } from '@/lib/db';

const USD_PER_TOKEN = 0.042 / 1_000_000;

export function DecisionPanel({ decision, history, accent }: { decision: Decision | null; history: Decision[]; accent: string }) {
  if (!decision) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Waiting for Jev&apos;s first move…</div>;
  }
  const ids = Object.keys(decision.labels);
  // Few options keep a fixed order so the bars read like gauges; many options show the top eight.
  const rows = ids.length <= 6 ? ids : [...ids].sort((a, b) => (decision.probs[b] ?? 0) - (decision.probs[a] ?? 0)).slice(0, 8);
  const tokens = history.reduce((n, d) => n + d.tokens, 0);

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="Turn" value={`#${decision.seq}`} />
        <Stat label="Latency" value={`${decision.latency_ms} ms`} />
        <Stat label="Confidence" value={decision.confidence == null ? '—' : `${Math.round(decision.confidence * 100)}%`} />
        <Stat label="Options" value={String(ids.length)} />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
          Jev&apos;s choice {ids.length > rows.length && <span className="normal-case tracking-normal text-zinc-500">· top {rows.length} of {ids.length}</span>}
        </h3>
        <ul className="flex flex-col gap-2">
          {rows.map((id) => {
            const p = decision.probs[id] ?? 0;
            const chosen = id === decision.action;
            return (
              <li key={id} className={`relative h-10 overflow-hidden rounded-lg border ${chosen ? 'border-white/60' : 'border-white/10'} bg-white/[0.04]`}>
                <div
                  className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.max(p * 100, 0.5)}%`, background: chosen ? accent : `${accent}55` }}
                />
                <div className="relative flex h-full items-center justify-between px-3 text-sm font-medium">
                  <span className={chosen ? 'text-white' : 'text-zinc-300'}>{chosen && '▶ '}{decision.labels[id]}</span>
                  <span className="font-mono tabular-nums text-zinc-100">{(p * 100).toFixed(1)}%</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-h-0 flex-1">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Recent moves</h3>
        <div className="flex flex-wrap gap-1.5">
          {history.map((d) => (
            <span key={d.seq} className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-xs text-zinc-300">
              {d.labels[d.action] ?? d.action}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        {tokens.toLocaleString()} input tokens over the last {history.length} moves ≈ ${(tokens * USD_PER_TOKEN).toFixed(5)} · output is free
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2 py-2">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="font-mono text-sm tabular-nums text-zinc-100">{value}</div>
    </div>
  );
}
