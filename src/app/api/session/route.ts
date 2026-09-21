import { randomInt } from 'node:crypto';
import { gameById } from '@/games';
import { adminDb, budgetLeft } from '@/lib/server';

// "Play live": returns the game's live session, starting one if there is none.
export async function POST(req: Request) {
  const { game } = (await req.json().catch(() => ({}))) as { game?: string };
  if (typeof game !== 'string' || !gameById(game)) return Response.json({ error: 'unknown game' }, { status: 400 });

  const db = adminDb();
  await db.rpc('end_idle_sessions');
  const live = await db.from('sessions').select('*').eq('game', game).eq('status', 'live').maybeSingle();
  if (live.data) return Response.json({ session: live.data });

  if ((await budgetLeft(db)) <= 0) return Response.json({ error: 'budget' }, { status: 429 });
  const created = await db.from('sessions').insert({ game, seed: randomInt(2 ** 31) }).select().single();
  if (created.data) return Response.json({ session: created.data });
  // Lost the race against another viewer's start: the unique index kept one live row, use it.
  const again = await db.from('sessions').select('*').eq('game', game).eq('status', 'live').maybeSingle();
  if (again.data) return Response.json({ session: again.data });
  return Response.json({ error: created.error?.message ?? 'could not start' }, { status: 500 });
}
