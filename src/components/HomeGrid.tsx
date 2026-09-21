'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GAMES } from '@/games';
import { browserDb, isLive, liveAt, type Decision, type Session } from '@/lib/db';
import { GameCanvas } from './GameCanvas';
import { LiveBadge } from './LiveBadge';

type Card = { session: Session | null; decision: Decision | null; at: number };
const ACTIVE_MS = 20_000; // "live" on a card means Jev moved recently, not just that a session is open

export function HomeGrid() {
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [now, setNow] = useState(0);

  useEffect(() => {
    const db = browserDb();
    const load = async (game: string) => {
      const { data } = await db.from('sessions').select('*').eq('game', game).gt('last_seq', 0)
        .order('started_at', { ascending: false }).limit(5);
      const rows = (data ?? []) as Session[];
      const s = rows.find(isLive) ?? rows[0] ?? null;
      const d = s ? (await db.from('decisions').select('*').eq('session_id', s.id).eq('seq', s.last_seq).maybeSingle()).data as Decision | null : null;
      setNow(Date.now());
      setCards((c) => ({ ...c, [game]: { session: s, decision: d, at: performance.now() } }));
    };
    GAMES.forEach((g) => load(g.id));
    const ch = db.channel('home')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'decisions' }, ({ new: d }) => {
        setCards((c) => {
          const entry = Object.entries(c).find(([, v]) => v.session?.id === (d as Decision).session_id);
          if (!entry) return c;
          const [game, v] = entry;
          return { ...c, [game]: { session: { ...v.session!, last_at: (d as Decision).at, last_seq: (d as Decision).seq }, decision: d as Decision, at: performance.now() } };
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' }, ({ new: s }) => load((s as Session).game))
      .subscribe();
    const iv = setInterval(() => setNow(Date.now()), 5000); // let LIVE badges lapse
    return () => { db.removeChannel(ch); clearInterval(iv); };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {GAMES.map((g) => {
        const c = cards[g.id];
        const active = !!c?.session && liveAt(c.session, now) && now - Date.parse(c.session.last_at) < ACTIVE_MS;
        return (
          <Link key={g.id} href={`/play/${g.id}`} className="group overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 transition hover:-translate-y-1 hover:border-white/30">
            <div className="relative aspect-[4/3] bg-black">
              <GameCanvas game={g} decision={c?.decision ?? null} shownAt={c?.at ?? 0} seed={7} className="h-full w-full" />
              {active && <LiveBadge className="absolute left-3 top-3 shadow-lg" />}
              {!active && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <span className="rounded-full px-5 py-2 text-sm font-black uppercase tracking-wider text-black" style={{ background: g.accent }}>▶ Play</span>
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <div>
                <h2 className="text-lg font-bold">{g.title}</h2>
                <p className="text-sm text-zinc-400">{g.blurb}</p>
              </div>
              {c?.session && <span className="font-mono text-sm text-zinc-300">{c.session.score.toLocaleString()}</span>}
            </div>
            <div className="h-1" style={{ background: g.accent }} />
          </Link>
        );
      })}
    </div>
  );
}
