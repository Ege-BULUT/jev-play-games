'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { gameById } from '@/games';
import { browserDb, type Session } from '@/lib/db';
import { useGameFeed } from '@/lib/useGameFeed';
import { GameCanvas } from './GameCanvas';
import { DecisionPanel } from './DecisionPanel';
import { LiveBadge } from './LiveBadge';

export function PlayView({ gameId, replayId }: { gameId: string; replayId?: string }) {
  const game = gameById(gameId)!;
  const feed = useGameFeed(gameId, game.stepMs, replayId);
  const [starting, setStarting] = useState(false);
  const showOverlay = feed.mode === 'replay' || feed.mode === 'empty';

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">← All games</Link>
        <h1 className="text-2xl font-black tracking-tight md:text-3xl">{game.title}</h1>
        {feed.mode === 'live' && <LiveBadge />}
        {feed.mode === 'replay' && <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest text-zinc-300">Replay</span>}
        {feed.mode === 'live' && <span className="text-sm text-zinc-400">{feed.watchers} watching</span>}
        {feed.session && <span className="ml-auto font-mono text-sm text-zinc-300">Score {feed.decision ? game.score(game.step(feed.decision.state, feed.decision.action)) : 0}</span>}
      </header>

      <div className="flex flex-col gap-6 md:flex-row">
        <section className="relative aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-black md:aspect-auto md:h-[min(72vh,760px)] md:w-[60%]">
          <GameCanvas game={game} decision={feed.decision} shownAt={feed.shownAt} seed={feed.session?.seed} className="h-full w-full" />
          {feed.over && feed.mode === 'live' && (
            <div className="absolute inset-x-0 top-6 mx-auto w-fit rounded-full bg-black/70 px-4 py-2 text-sm font-semibold">Game over · next game starts shortly</div>
          )}
          {showOverlay && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/45 backdrop-blur-[2px]">
              <button
                disabled={starting}
                onClick={async () => { setStarting(true); await feed.playLive(); setStarting(false); }}
                className="rounded-full px-8 py-4 text-lg font-black uppercase tracking-wider text-black shadow-2xl transition hover:scale-105 disabled:opacity-60"
                style={{ background: game.accent }}
              >
                {starting ? 'Waking Jev…' : '▶ Play live'}
              </button>
              <p className="max-w-xs text-center text-sm text-zinc-300">
                {feed.mode === 'replay'
                  ? `Behind this: a recorded game${feed.session ? ` from ${new Date(feed.session.started_at).toLocaleString()}` : ''}. Press play and Jev starts a new one, live for everyone on this page.`
                  : 'No recordings yet. Press play and Jev starts the first game, live for everyone on this page.'}
              </p>
            </div>
          )}
          {feed.error && <div className="absolute inset-x-4 bottom-4 rounded-lg bg-red-950/90 px-4 py-2 text-sm text-red-200">{feed.error}</div>}
        </section>

        <aside className="rounded-2xl border border-white/10 bg-zinc-950/80 p-5 md:w-[40%]">
          <DecisionPanel decision={feed.decision} history={feed.history} accent={game.accent} />
        </aside>
      </div>

      <Replays gameId={gameId} current={feed.session?.id} />
    </main>
  );
}

function Replays({ gameId, current }: { gameId: string; current?: string }) {
  const [rows, setRows] = useState<Session[]>([]);
  useEffect(() => {
    browserDb().from('sessions').select('*').eq('game', gameId).eq('status', 'ended').gt('last_seq', 0)
      .order('started_at', { ascending: false }).limit(12).then(({ data }) => setRows((data ?? []) as Session[]));
  }, [gameId, current]);
  if (!rows.length) return null;
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Recorded games</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {rows.map((s) => (
          <Link key={s.id} href={`/play/${gameId}?replay=${s.id}`}
            className={`rounded-xl border px-3 py-2 text-sm hover:border-white/40 ${s.id === current ? 'border-white/50' : 'border-white/10'}`}>
            <div className="font-mono text-base text-white">{s.score.toLocaleString()}</div>
            <div className="text-xs text-zinc-400">{s.last_seq} moves · {new Date(s.started_at).toLocaleDateString()}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
