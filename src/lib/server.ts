import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { AnyGame } from '@/games/types';
import type { Decision } from './db';

export const adminDb = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

export const JEV_USD_PER_TOKEN = 0.042 / 1_000_000;
export const DAILY_CAP_USD = Number(process.env.JEV_DAILY_CAP_USD ?? 1);

export async function budgetLeft(db = adminDb()) {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await db.from('spend').select('input_tokens').eq('day', day).maybeSingle();
  return DAILY_CAP_USD - (data?.input_tokens ?? 0) * JEV_USD_PER_TOKEN;
}

// The state a turn is decided from is derived here, never taken from the client: the seed for
// turn 1, otherwise the previous snapshot with the previous action applied. A client can only ask
// "decide the next turn", so the Jev key cannot be pointed at arbitrary text.
export function stateAt(game: AnyGame, seed: number, prev: Pick<Decision, 'state' | 'action'> | null) {
  return prev ? game.step(prev.state, prev.action) : game.init(seed);
}
