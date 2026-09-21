import type { Game, Option } from './types';
import { isInt, next } from './rng';

const N = 16;
type P = [number, number];
type Dir = 'up' | 'down' | 'left' | 'right';
type S = { body: P[]; dir: Dir; food: P; score: number; rng: number; dead: boolean };

const D: Record<Dir, P> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const ARROW: Record<Dir, string> = { up: '↑ Up', down: '↓ Down', left: '← Left', right: '→ Right' };
const key = ([x, y]: P) => y * N + x;
const inside = ([x, y]: P) => x >= 0 && y >= 0 && x < N && y < N;

function placeFood(body: P[], rng: number): [P, number] {
  const taken = new Set(body.map(key));
  const free: P[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!taken.has(y * N + x)) free.push([x, y]);
  const [r, s] = next(rng);
  return [free[Math.floor(r * free.length)] ?? [0, 0], s];
}

// Where the snake would be after moving in d: the new body, whether it ate, whether it died.
function advance(s: S, d: Dir) {
  const h: P = [s.body[0][0] + D[d][0], s.body[0][1] + D[d][1]];
  const eats = h[0] === s.food[0] && h[1] === s.food[1];
  const rest = eats ? s.body : s.body.slice(0, -1);
  const dies = !inside(h) || rest.some((p) => p[0] === h[0] && p[1] === h[1]);
  return { body: [h, ...rest], eats, dies };
}

// Cells reachable from the head: the room the snake keeps to live in.
function room(body: P[]) {
  const blocked = new Set(body.slice(1).map(key));
  const seen = new Set([key(body[0])]);
  const q = [body[0]];
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of Object.values(D)) {
      const n: P = [x + dx, y + dy];
      if (inside(n) && !blocked.has(key(n)) && !seen.has(key(n))) { seen.add(key(n)); q.push(n); }
    }
  }
  return seen.size - 1;
}

const dist = (a: P, b: P) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const isP = (v: unknown): v is P => Array.isArray(v) && v.length === 2 && v.every((c) => isInt(c) && c >= 0 && c < N);

export const snake: Game<S> = {
  id: 'snake',
  title: 'Snake',
  blurb: 'Eat, grow, never bite yourself.',
  accent: '#4ade80',
  instruction: 'Which direction should the snake move to survive and eat as much food as possible? Never move into a wall or its own body, and avoid moves that leave little room.',
  stepMs: 110,
  init(seed) {
    const body: P[] = [[4, 8], [3, 8], [2, 8]];
    const [food, rng] = placeFood(body, seed | 0);
    return { body, dir: 'right', food, score: 0, rng, dead: false };
  },
  isState(v): v is S {
    const s = v as S;
    return !!s && Array.isArray(s.body) && s.body.length >= 1 && s.body.length <= N * N && s.body.every(isP) &&
      isP(s.food) && s.dir in D && isInt(s.score) && isInt(s.rng) && typeof s.dead === 'boolean';
  },
  describe(s) {
    const grid = Array.from({ length: N }, () => Array(N).fill('.'));
    s.body.forEach(([x, y], i) => (grid[y][x] = i ? 'o' : 'H'));
    grid[s.food[1]][s.food[0]] = 'F';
    return `Snake on a ${N}x${N} grid (H head, o body, F food, . empty). Heading ${s.dir}, length ${s.body.length}.\n` +
      grid.map((r) => r.join('')).join('\n');
  },
  options(s) {
    const before = dist(s.body[0], s.food);
    return (Object.keys(D) as Dir[]).filter((d) => d !== OPP[s.dir]).map((d): Option => {
      const a = advance(s, d);
      if (a.dies) return { id: d, label: ARROW[d], detail: `Move ${d}: the snake crashes and the game ends.` };
      const r = room(a.body);
      const food = a.eats ? 'eats the food and grows' : `food distance ${before} → ${dist(a.body[0], s.food)}`;
      return { id: d, label: ARROW[d], detail: `Move ${d}: safe, ${food}, ${r} reachable free cells afterwards${r < a.body.length ? ' (a trap: less room than its length)' : ''}.` };
    });
  },
  step(s, action) {
    const d = (action in D && action !== OPP[s.dir] ? action : s.dir) as Dir;
    const a = advance(s, d);
    if (a.dies) return { ...s, dir: d, dead: true };
    if (!a.eats) return { ...s, body: a.body, dir: d };
    const [food, rng] = placeFood(a.body, s.rng);
    return { ...s, body: a.body, dir: d, food, rng, score: s.score + 1 };
  },
  over: (s) => s.dead || s.body.length >= N * N,
  score: (s) => s.score,
  render(ctx, s, w, h) {
    const size = Math.min(w, h) * 0.94, c = size / N, ox = (w - size) / 2, oy = (h - size) / 2;
    ctx.fillStyle = '#07130b'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#0d2415' : '#0b1f12';
      ctx.fillRect(ox + x * c, oy + y * c, c, c);
    }
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath(); ctx.arc(ox + (s.food[0] + 0.5) * c, oy + (s.food[1] + 0.5) * c, c * 0.36, 0, Math.PI * 2); ctx.fill();
    s.body.forEach(([x, y], i) => {
      ctx.fillStyle = i ? `hsl(142 70% ${Math.max(28, 55 - i)}%)` : s.dead ? '#fbbf24' : '#bbf7d0';
      ctx.beginPath(); ctx.roundRect(ox + x * c + 1, oy + y * c + 1, c - 2, c - 2, c * 0.28); ctx.fill();
    });
  },
};
