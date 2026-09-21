import { describe, expect, it } from 'vitest';
import { GAMES } from '../src/games';
import { g2048 } from '../src/games/g2048';
import { next } from '../src/games/rng';

describe.each(GAMES.map((g) => [g.id, g] as const))('%s', (_, g) => {
  it('plays a seeded game to the end with legal, serialisable, deterministic steps', () => {
    let s = g.init(42), pick = 7, turns = 0;
    while (!g.over(s) && turns < 3000) {
      const opts = g.options(s);
      expect(opts.length).toBeGreaterThan(0);
      expect(opts.length).toBeLessThanOrEqual(255);
      expect(new Set(opts.map((o) => o.id)).size).toBe(opts.length);
      const [r, p] = next(pick); pick = p;
      const a = opts[Math.floor(r * opts.length)].id;
      const copy = JSON.parse(JSON.stringify(s));
      expect(g.isState(copy)).toBe(true);
      s = g.step(s, a);
      expect(g.step(copy, a)).toEqual(s); // a snapshot plus an action is a replay
      turns++;
    }
    expect(turns).toBeGreaterThan(3);
    expect(g.score(s)).toBeGreaterThanOrEqual(0);
  });

  it('rejects malformed state', () => {
    for (const bad of [null, 1, 'x', {}, { ...g.init(1), rng: 'a' }]) expect(g.isState(bad)).toBe(false);
  });
});

it('2048 merges each pair once and scores the merged value', () => {
  const s = { b: [[1, 1, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 0, rng: 3, spawn: null };
  const out = g2048.step(s, 'left');
  expect(out.b[0].slice(0, 2)).toEqual([2, 3]);
  expect(out.score).toBe(4 + 8);
  expect(g2048.options(s).map((o) => o.id).sort()).toEqual(['down', 'left', 'right']);
});
