import { randomInt } from 'node:crypto';
import { gameById } from '@/games';
import { adminDb, budgetLeft } from '@/lib/server';

type Body = { game?: unknown; mode?: unknown; from?: unknown; seq?: unknown };

// "Play live". The game's live session always wins, since only one can run per game. Otherwise:
// - mode 'fork': a new session that carries on from turn `seq` of recording `from`;
// - mode 'new': a new game;
// - no mode: resume a game that stopped for lack of viewers, else a new game.
export async function POST(req: Request) {
  const { game, mode, from, seq } = (await req.json().catch(() => ({}))) as Body;
  const g = typeof game === 'string' ? gameById(game) : undefined;
  if (!g) return Response.json({ error: 'unknown game' }, { status: 400 });
  if (mode !== undefined && mode !== 'new' && mode !== 'fork') return Response.json({ error: 'bad mode' }, { status: 400 });
  if (mode === 'fork' && (typeof from !== 'string' || !/^[0-9a-f-]{36}$/.test(from) || !Number.isInteger(seq) || (seq as number) < 1)) {
    return Response.json({ error: 'bad fork' }, { status: 400 });
  }

  const db = adminDb();
  await db.rpc('end_idle_sessions');
  const liveNow = () => db.from('sessions').select('*').eq('game', g.id).eq('status', 'live').maybeSingle();
  const live = await liveNow();
  if (live.data) return Response.json({ session: live.data, joined: true });
  if ((await budgetLeft(db)) <= 0) return Response.json({ error: 'budget' }, { status: 429 });

  if (mode === 'fork') {
    const src = await db.from('sessions').select('game').eq('id', from as string).maybeSingle();
    if (src.data?.game !== g.id) return Response.json({ error: 'bad fork' }, { status: 400 });
    const forked = await db.rpc('fork_session', { p_src: from, p_seq: seq });
    if (forked.data?.id) {
      const last = await db.from('decisions').select('state, action').eq('session_id', forked.data.id).eq('seq', seq as number).single();
      const score = last.data ? g.score(g.step(last.data.state, last.data.action)) : 0;
      await db.from('sessions').update({ score }).eq('id', forked.data.id);
      return Response.json({ session: { ...forked.data, score } });
    }
    if (!forked.error) return Response.json({ error: 'bad fork' }, { status: 400 }); // turn out of range
  } else {
    if (mode === undefined) {
      // A game that stopped only because nobody was watching carries on where it stopped.
      const last = await db.from('sessions').select('id, status, end_reason, last_seq').eq('game', g.id)
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (last.data?.status === 'ended' && last.data.end_reason === 'idle' && last.data.last_seq > 0) {
        const resumed = await db.from('sessions')
          .update({ status: 'live', end_reason: null, ended_at: null, last_at: new Date().toISOString(), leader: null, claimed_seq: last.data.last_seq })
          .eq('id', last.data.id).eq('status', 'ended').select().maybeSingle();
        if (resumed.data) return Response.json({ session: resumed.data });
      }
    }
    const created = await db.from('sessions').insert({ game: g.id, seed: randomInt(2 ** 31) }).select().single();
    if (created.data) return Response.json({ session: created.data });
  }
  // Lost the race against another viewer's start: the unique index kept one live row, use it.
  const again = await liveNow();
  if (again.data) return Response.json({ session: again.data, joined: true });
  return Response.json({ error: 'could not start' }, { status: 500 });
}
