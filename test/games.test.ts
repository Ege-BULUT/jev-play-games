import { describe, expect, it } from 'vitest';
import { GAMES } from '../src/games';
import { g2048 } from '../src/games/g2048';
import { jevbros } from '../src/games/jevbros';
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
    for (const bad of [null, 1, 'x', {}, { ...g.init(1), rng: 'a', seed: 'a' }]) expect(g.isState(bad)).toBe(false);
  });
});

it('2048 merges each pair once and scores the merged value', () => {
  const s = { b: [[1, 1, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 0, rng: 3, spawn: null };
  const out = g2048.step(s, 'left');
  expect(out.b[0].slice(0, 2)).toEqual([2, 3]);
  expect(out.score).toBe(4 + 8);
  expect(g2048.options(s).map((o) => o.id).sort()).toEqual(['down', 'left', 'right']);
});

it('hill climb rewards reading the lookahead: a greedy safe policy outlasts flooring it', async () => {
  const { hillclimb: g } = await import('../src/games/hillclimb');
  const play = (seed: number, greedy: boolean) => {
    let s = g.init(seed);
    for (let n = 0; n < 3000 && !g.over(s); n++) {
      const opts = g.options(s).map((o) => ({ id: o.id, crash: /crashes/.test(o.detail), m: Number(/moves (-?[\d.]+)/.exec(o.detail)![1]) }));
      s = g.step(s, greedy ? (opts.filter((o) => !o.crash).sort((a, b) => b.m - a.m)[0] ?? opts[0]).id : 'gas');
    }
    return s;
  };
  const seeds = [1, 42, 777];
  expect(seeds.filter((seed) => play(seed, false).crashed).length).toBeGreaterThan(0);
  const greedy = seeds.map((seed) => play(seed, true));
  expect(Math.min(...greedy.map(g.score))).toBeGreaterThan(300);
});

it('Super Jev Bros: a lookahead policy clears the first 60 tiles of level 1 without losing a life', () => {
  // Pick the option that gets furthest after holding it for four turns and does not lose a life.
  type JS = ReturnType<typeof jevbros.init>;
  const hold = (s: JS, a: string) => { for (let i = 0; i < 4 && !jevbros.over(s); i++) s = jevbros.step(s, a); return s; };
  let s = jevbros.init(42), turns = 0;
  while (s.base + s.x < 60 && turns < 200) {
    const scored = jevbros.options(s).map((o) => {
      const e = hold(s, o.id);
      return { id: o.id, v: e.lives < s.lives ? -1e9 : e.base + e.x };
    });
    s = jevbros.step(s, scored.reduce((b, o) => (o.v > b.v ? o : b)).id);
    turns++;
  }
  expect(s.lv > 1 || s.x >= 60).toBe(true);
  expect(s.lives).toBe(3);
});
