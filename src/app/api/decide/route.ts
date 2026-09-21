import { GatewayRateLimitError } from '@ai-sdk/gateway';
import { gameById } from '@/games';
import type { Option } from '@/games/types';
import { ask } from '@/lib/jev';
import { adminDb, capTokens, stateAt } from '@/lib/server';
import type { Decision } from '@/lib/db';

const MIN_GAP_MS = 150; // per game, so a runaway client cannot spin Jev faster than the animation
const RPM = Number(process.env.JEV_RPM ?? 28); // the gateway's limit is 30 a minute for the project

type Begin = { error?: string; retry_ms?: number; game: string; seed: number; prev: Pick<Decision, 'state' | 'action'> | null };

// Decides turn `seq` of a live session. Whoever wins the claim in begin_turn is the leader for
// that turn; everyone else watches the decision arrive through realtime. Two database round trips
// per turn: begin_turn before asking Jev, finish_turn after.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { session?: unknown; leader?: unknown; seq?: unknown };
  const { session: id, leader, seq } = body;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || typeof leader !== 'string' || leader.length > 64 ||
      !Number.isInteger(seq) || (seq as number) < 1) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const n = seq as number;
  const db = adminDb();

  const begin = await db.rpc('begin_turn', { p_session: id, p_leader: leader, p_seq: n, p_min_gap_ms: MIN_GAP_MS, p_cap_tokens: capTokens(), p_rpm: RPM });
  if (begin.error) return Response.json({ error: begin.error.message }, { status: 500 });
  const b = begin.data as Begin;
  if (b.error === 'budget') return Response.json({ error: 'budget' }, { status: 429 });
  if (b.error === 'rate' || b.error === 'pace') return Response.json({ error: b.error, retryMs: b.retry_ms }, { status: 503 });
  if (b.error) return Response.json({ error: b.error }, { status: 409 });
  const game = gameById(b.game);
  if (!game) return Response.json({ error: 'unknown game' }, { status: 400 });
  const state = stateAt(game, b.seed, b.prev);

  if (game.over(state)) {
    await db.from('sessions').update({ status: 'ended', ended_at: new Date().toISOString(), score: game.score(state) })
      .eq('id', id).eq('status', 'live');
    return Response.json({ over: true });
  }

  const options: Option[] = game.options(state);
  const t0 = Date.now();
  let pick;
  try {
    pick = await ask(game.describe(state), game.instruction, options);
  } catch (e) {
    await db.rpc('release_turn', { p_session: id, p_seq: n }); // let the leader retry this turn
    if (GatewayRateLimitError.isInstance(e)) {
      const after = Number((e.cause as { responseHeaders?: Record<string, string> } | undefined)?.responseHeaders?.['retry-after']);
      return Response.json({ error: 'rate', retryMs: (Number.isFinite(after) && after > 0 ? after : 5) * 1000 }, { status: 503 });
    }
    return Response.json({ error: `jev: ${(e as Error).message}`, retryMs: 2000 }, { status: 503 });
  }
  const decision = {
    session_id: id, seq: n, state, action: pick.action, probs: pick.probs,
    labels: Object.fromEntries(options.map((o) => [o.id, o.label])),
    confidence: pick.confidence, latency_ms: Date.now() - t0, tokens: pick.tokens,
  };
  const fin = await db.rpc('finish_turn', { p_decision: decision, p_score: game.score(game.step(state, pick.action)) });
  if (fin.error) return Response.json({ error: fin.error.message }, { status: 500 });
  if (!fin.data) return Response.json({ error: 'turn taken' }, { status: 409 }); // another leader got here first
  return Response.json({ decision: { ...decision, at: new Date().toISOString() } });
}
