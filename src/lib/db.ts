import { createClient } from '@supabase/supabase-js';

export type Session = {
  id: string; game: string; seed: number; status: 'live' | 'ended';
  last_seq: number; last_at: string; started_at: string; ended_at: string | null; score: number;
};
export type Decision = {
  session_id: string; seq: number; state: unknown; action: string;
  probs: Record<string, number>; labels: Record<string, string>;
  confidence: number | null; latency_ms: number; tokens: number; at: string;
};

// Browser client: anon key, read-only through RLS, plus realtime.
export const browserDb = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

// A session is only live while someone drives it; past 3 idle minutes it counts as ended even
// before the server gets round to marking it.
export const IDLE_MS = 3 * 60_000;
export const liveAt = (s: Pick<Session, 'status' | 'last_at'>, now: number) =>
  s.status === 'live' && now - Date.parse(s.last_at) < IDLE_MS;
// One parameter on purpose: it is passed straight to Array#find, which supplies an index second.
export const isLive = (s: Pick<Session, 'status' | 'last_at'>) => liveAt(s, Date.now());
