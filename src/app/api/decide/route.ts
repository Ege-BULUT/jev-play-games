import { gameById } from '@/games';
import type { Option } from '@/games/types';
import { ask } from '@/lib/jev';
import { adminDb, budgetLeft, stateAt } from '@/lib/server';

const MIN_GAP_MS = 150; // per game, so a runaway client cannot spin Jev faster than the animation

// Decides turn `seq` of a live session. Whoever wins claim_turn is the leader for that turn;
// everyone else watches the decision arrive through realtime.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { session?: unknown; leader?: unknown; seq?: unknown };
  const { session: id, leader, seq } = body;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || typeof leader !== 'string' || leader.length > 64 ||
      !Number.isInteger(seq) || (seq as number) < 1) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const n = seq as number;
  const db = adminDb();
  if ((await budgetLeft(db)) <= 0) return Response.json({ error: 'budget' }, { status: 429 });

  const claim = await db.rpc('claim_turn', { p_session: id, p_leader: leader, p_seq: n, p_min_gap_ms: MIN_GAP_MS });
  if (claim.error) return Response.json({ error: claim.error.message }, { status: 500 });
  if (!claim.data) return Response.json({ error: 'not your turn' }, { status: 409 });

  const { data: session } = await db.from('sessions').select('*').eq('id', id).single();
  const game = session && gameById(session.game);
  if (!game) return Response.json({ error: 'unknown game' }, { status: 400 });
  const prev = n === 1 ? null
    : (await db.from('decisions').select('state, action').eq('session_id', id).eq('seq', n - 1).single()).data;
  if (n > 1 && !prev) return Response.json({ error: 'missing turn' }, { status: 409 });
  const state = stateAt(game, session.seed, prev);

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
    return Response.json({ error: `jev: ${(e as Error).message}` }, { status: 503 });
  }
  const decision = {
    session_id: id, seq: n, state, action: pick.action, probs: pick.probs,
    labels: Object.fromEntries(options.map((o) => [o.id, o.label])),
    confidence: pick.confidence, latency_ms: Date.now() - t0, tokens: pick.tokens,
  };
  const ins = await db.from('decisions').insert(decision);
  if (ins.error) return Response.json({ error: 'turn taken' }, { status: 409 }); // another leader got here first
  await Promise.all([
    db.from('sessions').update({ last_seq: n, last_at: new Date().toISOString(), score: game.score(game.step(state, pick.action)) }).eq('id', id),
    pick.tokens ? db.rpc('add_spend', { p_tokens: pick.tokens }) : null,
  ]);
  return Response.json({ decision });
}
