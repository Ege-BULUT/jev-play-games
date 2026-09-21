import type { Game, Option } from './types';
import { isInt, isIntGrid, next } from './rng';

const N = 8;
type Cell = [number, number]; // [row, col]
// Board cells hold 0 (empty) or 1 + the colour index of the piece that filled them.
type S = { b: number[][]; hand: number[]; score: number; rng: number; last: Cell[]; cleared: Cell[] };

const SHAPES: Cell[][] = [
  [[0, 0]],
  [[0, 0], [0, 1]], [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [1, 1]], [[0, 1], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 0]], [[0, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 0], [0, 1], [0, 2], [1, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[0, 2], [1, 0], [1, 1], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 1]], [[0, 1], [1, 0], [1, 1], [2, 1]],
  [[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]],
];
const NAMES = 'ABC';
const COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9'];

const fits = (b: number[][], p: number, r: number, c: number) =>
  SHAPES[p].every(([dr, dc]) => r + dr < N && c + dc < N && !b[r + dr][c + dc]);

function place(b: number[][], p: number, r: number, c: number) {
  const g = b.map((row) => [...row]);
  const colour = 1 + (p % COLORS.length);
  const cells: Cell[] = SHAPES[p].map(([dr, dc]) => [r + dr, c + dc]);
  cells.forEach(([i, j]) => (g[i][j] = colour));
  const rows = [...Array(N).keys()].filter((i) => g[i].every(Boolean));
  const cols = [...Array(N).keys()].filter((j) => g.every((row) => row[j]));
  const cleared: Cell[] = [];
  rows.forEach((i) => g[i].forEach((_, j) => cleared.push([i, j])));
  cols.forEach((j) => g.forEach((_, i) => cleared.push([i, j])));
  cleared.forEach(([i, j]) => (g[i][j] = 0));
  const lines = rows.length + cols.length;
  return { b: g, cells, cleared, lines, points: cells.length + 10 * lines * lines };
}

// Empty cells boxed in on all four sides: no piece but the 1x1 can ever fill them.
const holes = (b: number[][]) => b.reduce((n, row, i) => n + row.filter((v, j) => !v &&
  [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].every(([a, c]) => a < 0 || c < 0 || a >= N || c >= N || b[a][c])).length, 0);

const anyFit = (b: number[][], p: number) => {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (fits(b, p, r, c)) return true;
  return false;
};

function deal(rng: number): [number[], number] {
  const hand: number[] = [];
  for (let i = 0; i < 3; i++) { const [v, s] = next(rng); rng = s; hand.push(Math.floor(v * SHAPES.length)); }
  return [hand, rng];
}

const shapeText = (p: number) => {
  const h = Math.max(...SHAPES[p].map((c) => c[0])) + 1, w = Math.max(...SHAPES[p].map((c) => c[1])) + 1;
  return `${SHAPES[p].length}-cell ${h}x${w}`;
};

export const blocks: Game<S> = {
  id: 'blocks',
  title: 'Block Blitz',
  blurb: 'Drop three pieces, clear rows and columns.',
  accent: '#818cf8',
  instruction: 'Which placement is best for a long block-puzzle game? Clear lines, avoid isolated holes, and keep room so the remaining pieces still fit.',
  stepMs: 260,
  init(seed) {
    const [hand, rng] = deal(seed | 0);
    return { b: Array.from({ length: N }, () => Array(N).fill(0)), hand, score: 0, rng, last: [], cleared: [] };
  },
  isState(v): v is S {
    const s = v as S;
    return !!s && isIntGrid(s.b, N, N, COLORS.length) && Array.isArray(s.hand) && s.hand.length === 3 &&
      s.hand.every((p) => isInt(p) && p >= -1 && p < SHAPES.length) && isInt(s.score) && isInt(s.rng);
  },
  describe(s) {
    const hand = s.hand.map((p, i) => (p < 0 ? `${NAMES[i]}: used` : `${NAMES[i]}: ${shapeText(p)}`)).join(', ');
    return `Block puzzle, ${N}x${N} board, # filled, . empty. A full row or column clears.\n` +
      s.b.map((r) => r.map((v) => (v ? '#' : '.')).join('')).join('\n') + `\nPieces in hand: ${hand}. Score ${s.score}.`;
  },
  options(s) {
    const out: Option[] = [];
    s.hand.forEach((p, slot) => {
      if (p < 0) return;
      const others = s.hand.filter((q, k) => k !== slot && q >= 0);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (!fits(s.b, p, r, c)) continue;
        const m = place(s.b, p, r, c);
        const stuck = others.filter((q) => !anyFit(m.b, q)).length;
        out.push({
          id: `${slot}:${r}:${c}`,
          label: `${NAMES[slot]} → r${r + 1} c${c + 1}${m.lines ? ` ✦${m.lines}` : ''}`,
          detail: `Piece ${NAMES[slot]} (${shapeText(p)}) at row ${r + 1} col ${c + 1}: ` +
            `${m.lines ? `clears ${m.lines} line${m.lines > 1 ? 's' : ''}` : 'clears nothing'}, +${m.points} points, ` +
            `${m.b.flat().filter((v) => !v).length} empty cells, ${holes(m.b)} isolated holes` +
            (stuck ? `, leaves ${stuck} remaining piece${stuck > 1 ? 's' : ''} with nowhere to go.` : '.'),
        });
      }
    });
    return out.slice(0, 255);
  },
  step(s, action) {
    const [slot, r, c] = action.split(':').map(Number);
    const p = s.hand[slot];
    if (p === undefined || p < 0 || !fits(s.b, p, r, c)) return s;
    const m = place(s.b, p, r, c);
    let hand = s.hand.map((q, k) => (k === slot ? -1 : q)), rng = s.rng;
    if (hand.every((q) => q < 0)) [hand, rng] = deal(rng);
    return { b: m.b, hand, score: s.score + m.points, rng, last: m.cells, cleared: m.cleared };
  },
  over: (s) => s.hand.every((p) => p < 0 || !anyFit(s.b, p)),
  score: (s) => s.score,
  render(ctx, s, w, h, t) {
    ctx.fillStyle = '#0f1024'; ctx.fillRect(0, 0, w, h);
    const size = Math.min(w, h * 0.74), c = size / N, ox = (w - size) / 2, oy = h * 0.03;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const v = s.b[i][j];
      ctx.fillStyle = v ? COLORS[v - 1] : '#1c1e3d';
      ctx.beginPath(); ctx.roundRect(ox + j * c + 2, oy + i * c + 2, c - 4, c - 4, c * 0.15); ctx.fill();
    }
    ctx.strokeStyle = `rgba(255,255,255,${1 - t})`; ctx.lineWidth = 3;
    s.last.forEach(([i, j]) => { ctx.beginPath(); ctx.roundRect(ox + j * c + 2, oy + i * c + 2, c - 4, c - 4, c * 0.15); ctx.stroke(); });
    ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
    s.cleared.forEach(([i, j]) => { ctx.beginPath(); ctx.roundRect(ox + j * c + 2, oy + i * c + 2, c - 4, c - 4, c * 0.15); ctx.fill(); });
    const hc = c * 0.42, slotW = w / 3, hy = oy + size + h * 0.05;
    ctx.font = `600 ${Math.max(12, c * 0.3)}px ui-sans-serif, system-ui`; ctx.textAlign = 'center';
    s.hand.forEach((p, k) => {
      ctx.fillStyle = '#94a3b8'; ctx.fillText(NAMES[k], slotW * k + slotW / 2, hy - 6);
      if (p < 0) return;
      const pw = (Math.max(...SHAPES[p].map((x) => x[1])) + 1) * hc;
      ctx.fillStyle = COLORS[p % COLORS.length];
      SHAPES[p].forEach(([dr, dc]) => { ctx.beginPath(); ctx.roundRect(slotW * k + slotW / 2 - pw / 2 + dc * hc + 1, hy + dr * hc + 1, hc - 2, hc - 2, 3); ctx.fill(); });
    });
  },
};
