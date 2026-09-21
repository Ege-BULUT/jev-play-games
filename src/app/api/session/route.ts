import { randomInt } from 'node:crypto';
import { gameById } from '@/games';
import { adminDb, budgetLeft } from '@/lib/server';

// "Play live": returns the game's live session, else resumes one that stopped for lack of viewers,
// else starts a new game.
export async function POST(req: Request) {
  const { game } = (await req.json().catch(() => ({}))) as { game?: string };
  if (typeof game !== 'string' || !gameById(game)) return Response.json({ error: 'unknown game' }, { status: 400 });

  const db = adminDb();
  await db.rpc('end_idle_sessions');
  const live = await db.from('sessions').select('*').eq('game', game).eq('status', 'live').maybeSingle();
  if (live.data) return Response.json({ session: live.data });

  if ((await budgetLeft(db)) <= 0) return Response.json({ error: 'budget' }, { status: 429 });

  // A game that stopped only because nobody was watching carries on where it stopped.
  const last = await db.from('sessions').select('id, status, end_reason, last_seq').eq('game', game)
    .order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (last.data?.status === 'ended' && last.data.end_reason === 'idle' && last.data.last_seq > 0) {
    const resumed = await db.from('sessions')
      .update({ status: 'live', end_reason: null, ended_at: null, last_at: new Date().toISOString(), leader: null, claimed_seq: last.data.last_seq })
      .eq('id', last.data.id).eq('status', 'ended').select().maybeSingle();
    if (resumed.data) return Response.json({ session: resumed.data });
  }

  const created = await db.from('sessions').insert({ game, seed: randomInt(2 ** 31) }).select().single();
  if (created.data) return Response.json({ session: created.data });
  // Lost the race against another viewer's start: the unique index kept one live row, use it.
  const again = await db.from('sessions').select('*').eq('game', game).eq('status', 'live').maybeSingle();
  if (again.data) return Response.json({ session: again.data });
  return Response.json({ error: created.error?.message ?? 'could not start' }, { status: 500 });
}
