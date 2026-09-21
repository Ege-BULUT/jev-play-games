'use client';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { browserDb, isLive, type Decision, type Session } from './db';

export type Feed = {
  mode: 'loading' | 'live' | 'replay' | 'empty';
  session: Session | null;
  decision: Decision | null; // the one on screen
  shownAt: number;           // when it went on screen, drives the step animation
  history: Decision[];       // last few, newest first
  watchers: number;
  error: string | null;
  over: boolean;
  pacing: boolean;           // waiting out the model's rate limit
  replay: Replay | null;     // controls while a recording plays
  playLive: (start?: Start) => Promise<void>;
};
export type Replay = { count: number; index: number; paused: boolean; seek: (i: number) => void; toggle: () => void };
// No start: resume a paused game or start one. 'new': a new game. 'fork': carry on from a recorded turn.
export type Start = { mode: 'new' } | { mode: 'fork'; from: string; seq: number };

const LEASE_MS = 6500; // a little over the server's 6 s lease, so followers do not steal a live leader's turn
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: SupabaseClient | null = null;
const client = () => (db ??= browserDb());

export async function allDecisions(sessionId: string) {
  const out: Decision[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client().from('decisions').select('*').eq('session_id', sessionId)
      .order('seq').range(from, from + 999);
    if (error) throw error;
    out.push(...(data as Decision[]));
    if (!data || data.length < 1000) return out;
  }
}

export function useGameFeed(gameId: string, stepMs: number, replayId?: string): Feed {
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<Feed['mode']>('loading');
  const [shown, setShown] = useState<{ d: Decision | null; at: number }>({ d: null, at: 0 });
  const [history, setHistory] = useState<Decision[]>([]);
  const [watchers, setWatchers] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [pacing, setPacing] = useState(false);
  const [rec, setRec] = useState<Decision[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const me = useRef<string>('');
  const leading = useRef(false);
  const lastSeq = useRef(0);
  const lastSeen = useRef(0);

  const show = (d: Decision) => {
    if (d.seq <= lastSeq.current) return; // realtime and the fetch reply both deliver our own turns
    lastSeq.current = Math.max(lastSeq.current, d.seq);
    lastSeen.current = Date.now();
    setShown({ d, at: performance.now() });
    setHistory((h) => [d, ...h.filter((x) => x.seq !== d.seq)].slice(0, 24));
  };

  async function playLive(start?: Start) {
    setError(null);
    const r = await fetch('/api/session', { method: 'POST', body: JSON.stringify({ game: gameId, ...start }) });
    const j = await r.json();
    if (!r.ok) { setError(j.error === 'budget' ? "Today's Jev budget is spent. Replays keep playing; live is back tomorrow (UTC)." : j.error); return; }
    leading.current = !j.joined; // joining someone else's live game means following it
    if (replayId) window.history.replaceState(null, '', `/play/${gameId}`); // no longer that recording
    enterLive(j.session);
  }

  function enterLive(s: Session) {
    setOver(false);
    lastSeq.current = 0;
    lastSeen.current = Date.now();
    setHistory([]);
    setShown({ d: null, at: 0 });
    setSession(s);
    setMode('live');
  }

  // Pick the starting mode: a requested replay, else the live session, else the latest replay.
  useEffect(() => {
    me.current ||= crypto.randomUUID();
    let cancelled = false;
    (async () => {
      const q = client().from('sessions').select('*').eq('game', gameId);
      const { data } = replayId ? await q.eq('id', replayId) : await q.order('started_at', { ascending: false }).limit(10);
      if (cancelled) return;
      const rows = (data ?? []) as Session[];
      const live = !replayId && rows.find(isLive);
      if (live) { enterLive(live); return; }
      // Not live: a finished game, or a 'live' row nobody has driven for 3 minutes (paused, resumable).
      const rec = rows.find((s) => s.last_seq > 0);
      if (rec) { setSession(rec); setMode('replay'); } else setMode('empty');
    })();
    return () => { cancelled = true; };
  }, [gameId, replayId]);

  // Replay: loop the recording at the pace it was played, clamped so it never crawls. It can be
  // paused and scrubbed, so a viewer can pick the turn to continue from.
  const goto = (ds: Decision[], i: number) => { setIdx(i); if (ds[i]) setShown({ d: ds[i], at: performance.now() }); };
  useEffect(() => {
    if (mode !== 'replay' || !session) return;
    let stop = false;
    allDecisions(session.id).then((ds) => { if (!stop) { setRec(ds); setPaused(false); goto(ds, 0); } });
    return () => { stop = true; };
  }, [mode, session]);
  useEffect(() => {
    if (mode !== 'replay' || paused || !rec.length) return;
    const gap = idx + 1 < rec.length ? Date.parse(rec[idx + 1].at) - Date.parse(rec[idx].at) : 2500;
    const t = setTimeout(() => goto(rec, (idx + 1) % rec.length), Math.min(1500, Math.max(stepMs + 60, gap)));
    return () => clearTimeout(t);
  }, [mode, paused, rec, idx, stepMs]);
  const replay: Replay | null = mode === 'replay' && rec.length ? {
    count: rec.length, index: idx, paused,
    seek: (i) => { setPaused(true); goto(rec, Math.max(0, Math.min(rec.length - 1, i))); },
    toggle: () => setPaused((p) => !p),
  } : null;

  // Live: follow the session through realtime, and drive it whenever this tab holds the lease
  // or the previous leader has gone quiet. A hidden tab never drives, so an unwatched game makes
  // no Jev calls and the server closes it after three idle minutes.
  useEffect(() => {
    if (mode !== 'live' || !session) return;
    let stop = false;
    const channel = client().channel(`game:${gameId}`, { config: { presence: { key: me.current } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'decisions', filter: `session_id=eq.${session.id}` },
        (p) => show(p.new as Decision))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
        (p) => { if ((p.new as Session).status === 'ended') setOver(true); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions', filter: `game=eq.${gameId}` },
        (p) => { if (!stop) enterLive(p.new as Session); })
      .on('presence', { event: 'sync' }, () => setWatchers(Math.max(1, Object.keys(channel.presenceState()).length)))
      .subscribe((status) => { if (status === 'SUBSCRIBED') channel.track({ at: Date.now() }); });

    (async () => {
      const past = await allDecisions(session.id);
      if (past.length) { past.slice(-24).forEach(show); }
      while (!stop) {
        if (document.visibilityState !== 'visible') { leading.current = false; await sleep(500); continue; }
        if (!leading.current && Date.now() - lastSeen.current < LEASE_MS + Math.random() * 1500) { await sleep(400); continue; }
        const t0 = Date.now();
        const r = await fetch('/api/decide', { method: 'POST', body: JSON.stringify({ session: session.id, leader: me.current, seq: lastSeq.current + 1 }) });
        const j = await r.json().catch(() => ({}));
        if (stop) break;
        if (r.ok && j.decision) { leading.current = true; setError(null); setPacing(false); show(j.decision); }
        else if (r.ok && j.over) { setOver(true); break; }
        else if (r.status === 409) {
          // Someone else holds the turn, or this tab missed a realtime insert: catch up from the table.
          leading.current = false;
          lastSeen.current = Date.now();
          const { data } = await client().from('decisions').select('*').eq('session_id', session.id)
            .gt('seq', lastSeq.current).order('seq');
          (data as Decision[] | null)?.forEach(show);
          const { data: row } = await client().from('sessions').select('*').eq('id', session.id).single();
          if (row && !isLive(row as Session)) { setSession(row as Session); setMode('replay'); break; } // idle too long: over
          await sleep(800);
          continue;
        }
        else if (r.status === 503 && j.retryMs) {
          // Rate limited: the server gave the turn back, so this tab keeps it and simply waits.
          setPacing(j.error === 'rate');
          lastSeen.current = Date.now() + j.retryMs; // followers must not read the wait as a dead leader
          await sleep(j.retryMs);
          continue;
        }
        else if (r.status === 429) { setError("Today's Jev budget is spent. Live is back tomorrow (UTC)."); break; }
        else { setError(j.error ?? `HTTP ${r.status}`); await sleep(2000); continue; }
        await sleep(Math.max(0, stepMs - (Date.now() - t0)));
      }
    })();
    return () => { stop = true; client().removeChannel(channel); };
  }, [mode, session, gameId, stepMs]);

  // Game over while live: the tab that was driving starts the next game after a pause.
  useEffect(() => {
    if (!over || mode !== 'live' || !leading.current) return;
    const t = setTimeout(() => { if (document.visibilityState === 'visible') playLive(); }, 5000);
    return () => clearTimeout(t);
  }, [over, mode]); // eslint-disable-line react-hooks/exhaustive-deps -- playLive reads only refs and props

    const shownHistory = mode === 'replay' ? rec.slice(Math.max(0, idx - 23), idx + 1).reverse() : history;
  return { mode, session, decision: shown.d, shownAt: shown.at, history: shownHistory, watchers, error, over, pacing, replay, playLive };
}
