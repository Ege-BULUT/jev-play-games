import type { Game, Option } from './types';
import { isInt, isIntGrid, next } from './rng';

// Tiles hold exponents: 0 is empty, 1 is a 2, 11 is 2048.
type S = { b: number[][]; score: number; rng: number; spawn: [number, number] | null };
type Dir = 'left' | 'right' | 'up' | 'down';
const DIRS: Dir[] = ['left', 'right', 'up', 'down'];
const ARROW: Record<Dir, string> = { left: '← Left', right: '→ Right', up: '↑ Up', down: '↓ Down' };

const transpose = (b: number[][]) => b[0].map((_, c) => b.map((r) => r[c]));
const flip = (b: number[][]) => b.map((r) => [...r].reverse());

function slideLeft(b: number[][]) {
  let gain = 0, merges = 0;
  const out = b.map((row) => {
    const t = row.filter(Boolean);
    const r: number[] = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === t[i + 1]) { r.push(t[i] + 1); gain += 2 ** (t[i] + 1); merges++; i++; }
      else r.push(t[i]);
    }
    while (r.length < 4) r.push(0);
    return r;
  });
  return { b: out, gain, merges };
}

function slide(b: number[][], d: Dir) {
  if (d === 'left') return slideLeft(b);
  if (d === 'right') { const m = slideLeft(flip(b)); return { ...m, b: flip(m.b) }; }
  if (d === 'up') { const m = slideLeft(transpose(b)); return { ...m, b: transpose(m.b) }; }
  const m = slideLeft(flip(transpose(b)));
  return { ...m, b: transpose(flip(m.b)) };
}

const same = (a: number[][], b: number[][]) => a.every((r, i) => r.every((v, j) => v === b[i][j]));
const empties = (b: number[][]) => b.flatMap((r, i) => r.flatMap((v, j) => (v ? [] : [[i, j] as [number, number]])));
const maxTile = (b: number[][]) => Math.max(...b.flat());
const inCorner = (b: number[][]) => {
  const m = maxTile(b);
  return [b[0][0], b[0][3], b[3][0], b[3][3]].includes(m);
};

function spawn(s: S): S {
  const e = empties(s.b);
  if (!e.length) return { ...s, spawn: null };
  const [a, r1] = next(s.rng);
  const [v, r2] = next(r1);
  const [i, j] = e[Math.floor(a * e.length)];
  const b = s.b.map((r) => [...r]);
  b[i][j] = v < 0.9 ? 1 : 2;
  return { ...s, b, rng: r2, spawn: [i, j] };
}

const COLORS = ['#cdc1b4', '#eee4da', '#ede0c8', '#f2b179', '#f59563', '#f67c5f', '#f65e3b', '#edcf72', '#edcc61', '#edc850', '#edc53f', '#edc22e'];

export const g2048: Game<S> = {
  id: '2048',
  title: '2048',
  blurb: 'Slide, merge, chase the 2048 tile.',
  accent: '#edc22e',
  instruction: 'Which move gives the best long-term 2048 game? Prefer merges, keep the largest tile in a corner and keep the board open.',
  stepMs: 180,
  init(seed) {
    return spawn(spawn({ b: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 0, rng: seed | 0, spawn: null }));
  },
  isState(v): v is S {
    const s = v as S;
    return !!s && isIntGrid(s.b, 4, 4, 17) && isInt(s.score) && s.score >= 0 && isInt(s.rng);
  },
  describe(s) {
    return `2048 board, row by row, 0 is empty:\n${s.b.map((r) => r.map((v) => String(v ? 2 ** v : 0).padStart(5)).join('')).join('\n')}\nScore: ${s.score}`;
  },
  options(s) {
    return DIRS.flatMap((d): Option[] => {
      const m = slide(s.b, d);
      if (same(m.b, s.b)) return [];
      const detail = `Slide ${d}: +${m.gain} points from ${m.merges} merge${m.merges === 1 ? '' : 's'}, ` +
        `${empties(m.b).length} empty cells before the new tile, largest tile ${2 ** maxTile(m.b)} ` +
        (inCorner(m.b) ? 'sits in a corner.' : 'is not in a corner.');
      return [{ id: d, label: ARROW[d], detail }];
    });
  },
  step(s, action) {
    const m = slide(s.b, action as Dir);
    if (same(m.b, s.b)) return s;
    return spawn({ ...s, b: m.b, score: s.score + m.gain });
  },
  over(s) {
    return DIRS.every((d) => same(slide(s.b, d).b, s.b));
  },
  score: (s) => s.score,
  render(ctx, s, w, h, t) {
    const size = Math.min(w, h) * 0.92, gap = size * 0.025, cell = (size - gap * 5) / 4;
    const ox = (w - size) / 2, oy = (h - size) / 2;
    ctx.fillStyle = '#1a1612'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#bbada0'; roundRect(ctx, ox, oy, size, size, gap * 2); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    s.b.forEach((row, i) => row.forEach((v, j) => {
      const isNew = s.spawn && s.spawn[0] === i && s.spawn[1] === j;
      const k = isNew ? Math.min(1, t * 1.6) : 1;
      const x = ox + gap + j * (cell + gap) + (cell * (1 - k)) / 2, y = oy + gap + i * (cell + gap) + (cell * (1 - k)) / 2;
      ctx.fillStyle = COLORS[Math.min(v, 11)] ?? '#3c3a32';
      if (v > 11) ctx.fillStyle = '#3c3a32';
      roundRect(ctx, x, y, cell * k, cell * k, gap); ctx.fill();
      if (!v) return;
      const n = String(2 ** v);
      ctx.fillStyle = v <= 2 ? '#776e65' : '#f9f6f2';
      ctx.font = `700 ${(cell * k) / (n.length > 3 ? 3.4 : 2.4)}px ui-sans-serif, system-ui`;
      ctx.fillText(n, x + (cell * k) / 2, y + (cell * k) / 2);
    }));
  },
};

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
