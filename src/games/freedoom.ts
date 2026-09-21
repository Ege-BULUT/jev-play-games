import type { Game, Option } from './types';
import { isInt, next } from './rng';

// A grid-map raycaster shooter. One decision holds an input for FRAMES frames at 60 Hz; the player's
// poses ride along in the state and everything else carries the frame it happened on, so render()
// can replay the step. The map is rebuilt from (seed, level) on demand; only mutable things are stored.
const FRAMES = 15, N = 32, M = 2.5; // grid size in cells, metres per cell (for descriptions only)
const R = 0.25, FOV = 0.66, TURN = Math.PI / 4 / FRAMES, RUN = 2.4 / 60, STRAFE = 2 / 60;
const MAX_TURNS = 2400, LOOK_STEPS = 4;
const EXIT = 9;

type Enemy = { k: 0 | 1; x: number; y: number; px: number; py: number; hp: number; awake: boolean; cd: number; atk: number; died: number; hurt: number };
type Shot = { x: number; y: number; vx: number; vy: number; born: number; end: number };
type S = {
  seed: number; level: number; rng: number; t: number; turns: number;
  x: number; y: number; a: number; hp: number; armor: number; ammo: number;
  kills: number; levels: number; pickups: number; taken: number[];
  enemies: Enemy[]; shots: Shot[]; poses: [number, number, number][];
  fired: number; hurtAt: number; levelAt: number;
};
type Move = 'fwd' | 'back' | 'left' | 'right' | 'sl' | 'sr' | 'fire' | 'ff';
type Act = Move | 'aim'; // aim: fire only when something is in the crosshair (lookahead continuation)
const ACTS: Move[] = ['fwd', 'ff', 'fire', 'left', 'right', 'sl', 'sr', 'back'];

const KIND = [ // zombie: hitscan, imp: slow fireballs
  { name: 'zombie', hp: 20, speed: 1.0 / 60, reload: 70 },
  { name: 'imp', hp: 40, speed: 1.3 / 60, reload: 80 },
];
const ITEMS = [
  { name: 'medikit', img: 'media0' }, { name: 'stimpack', img: 'stima0' },
  { name: 'ammo clip', img: 'clipa0' }, { name: 'armor', img: 'arm1a0' },
];

function bfs(g: Uint8Array, from: number[]) { // grid steps from the given cells over open floor
  const d = new Int16Array(N * N).fill(-1);
  const q = [...from]; for (const c of from) d[c] = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const n of [c - 1, c + 1, c - N, c + N]) if (n >= 0 && n < N * N && d[n] < 0 && g[n] === 0) { d[n] = d[c] + 1; q.push(n); }
  }
  return d;
}

type Level = { g: Uint8Array; d: Int16Array; start: [number, number, number]; exit: number; enemies: Enemy[]; items: [number, number, number][] };
const levels = new Map<string, Level>();

function level(seed: number, lv: number): Level {
  const key = `${seed}:${lv}`;
  const hit = levels.get(key);
  if (hit) return hit;
  let r = (seed ^ Math.imul(lv + 1, 0x9e3779b1)) | 0;
  const rnd = () => { const [v, n] = next(r); r = n; return v; };
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const g = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) g[i] = 1 + ((((i % N) >> 3) + ((i / N) >> 3) + lv) % 3); // wall texture by region
  const rooms: { x: number; y: number; w: number; h: number }[] = [];
  for (let tries = 0; rooms.length < 6 && tries < 300; tries++) {
    const w = ri(4, 7), h = ri(4, 7), x = ri(1, N - w - 1), y = ri(1, N - h - 1);
    if (rooms.some((o) => x < o.x + o.w + 1 && o.x < x + w + 1 && y < o.y + o.h + 1 && o.y < y + h + 1)) continue;
    rooms.push({ x, y, w, h });
  }
  for (const o of rooms) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) g[y * N + x] = 0;
  const mid = (o: typeof rooms[0]) => [o.x + (o.w >> 1), o.y + (o.h >> 1)];
  for (let i = 1; i < rooms.length; i++) { // L-shaped corridors chaining the rooms
    const [ax, ay] = mid(rooms[i - 1]), [bx, by] = mid(rooms[i]);
    const hFirst = rnd() < 0.5;
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) g[(hFirst ? ay : by) * N + x] = 0;
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) g[y * N + (hFirst ? bx : ax)] = 0;
  }
  const [sx, sy] = mid(rooms[0]);
  const fromStart = bfs(g, [sy * N + sx]);
  // Exit: the wall cell next to open floor that is furthest from the start by path.
  let exit = -1, far = -1;
  for (let c = N; c < N * N - N; c++) {
    if (g[c] === 0 || c % N === 0 || c % N === N - 1) continue;
    for (const n of [c - 1, c + 1, c - N, c + N]) if (g[n] === 0 && fromStart[n] > far) { far = fromStart[n]; exit = c; }
  }
  g[exit] = EXIT;
  const d = bfs(g, [exit].flatMap((c) => [c - 1, c + 1, c - N, c + N].filter((n) => g[n] === 0)));
  for (let c = 0; c < N * N; c++) if (d[c] >= 0) d[c]++;
  d[exit] = 0;
  const [rx, ry] = mid(rooms[1] ?? rooms[0]);
  const start: [number, number, number] = [sx + 0.5, sy + 0.5, Math.atan2(ry - sy, rx - sx)];
  const used = new Set<number>();
  const spot = () => { // a free open cell in a room other than the first, away from the start
    for (let i = 0; ; i++) {
      const o = rooms[ri(Math.min(1, rooms.length - 1), rooms.length - 1)], x = ri(o.x, o.x + o.w - 1), y = ri(o.y, o.y + o.h - 1);
      if (i > 200 || (!used.has(y * N + x) && Math.hypot(x - sx, y - sy) > 4)) { used.add(y * N + x); return [x + 0.5, y + 0.5]; }
    }
  };
  const enemies: Enemy[] = [];
  for (let i = 0; i < Math.min(10, 3 + lv); i++) {
    const [x, y] = spot(), k = rnd() < Math.min(0.6, 0.15 + lv * 0.1) ? 1 : 0;
    enemies.push({ k, x, y, px: x, py: y, hp: KIND[k].hp, awake: false, cd: 0, atk: -99, died: -1, hurt: -99 });
  }
  const items: [number, number, number][] = [];
  for (let i = 0; i < rooms.length; i++) { const [x, y] = spot(); items.push([x, y, Math.floor(rnd() * ITEMS.length)]); }
  const L = { g, d, start, exit, enemies, items };
  if (levels.size > 64) levels.clear();
  levels.set(key, L);
  return L;
}

const solid = (L: Level, x: number, y: number) => {
  const cx = Math.floor(x), cy = Math.floor(y);
  return cx < 0 || cy < 0 || cx >= N || cy >= N || L.g[cy * N + cx] !== 0;
};
const blocked = (L: Level, x: number, y: number) => solid(L, x - R, y - R) || solid(L, x + R, y - R) || solid(L, x - R, y + R) || solid(L, x + R, y + R);

function sight(L: Level, ax: number, ay: number, bx: number, by: number) { // exact grid walk, walls only
  let x = Math.floor(ax), y = Math.floor(ay);
  const ex = Math.floor(bx), ey = Math.floor(by), dx = bx - ax, dy = by - ay;
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1, tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy);
  let tx = (dx < 0 ? ax - x : x + 1 - ax) * tdx, ty = (dy < 0 ? ay - y : y + 1 - ay) * tdy;
  for (let n = Math.abs(ex - x) + Math.abs(ey - y); n > 0; n--) { // one cell per step until the end cell
    if (tx < ty) { tx += tdx; x += sx; } else { ty += tdy; y += sy; }
    if (x === ex && y === ey) return true;
    if (x < 0 || y < 0 || x >= N || y >= N || L.g[y * N + x] !== 0) return false;
  }
  return true;
}

// Path distance to the exit in cells: the grid BFS field smoothed by the distance to a neighbour cell.
function toExit(L: Level, x: number, y: number) {
  const c = Math.floor(y) * N + Math.floor(x);
  let best = Infinity;
  for (const n of [c, c - 1, c + 1, c - N, c + N]) {
    if (n < 0 || n >= N * N || L.d[n] < 0) continue;
    best = Math.min(best, L.d[n] + Math.hypot(x - ((n % N) + 0.5), y - (Math.floor(n / N) + 0.5)));
  }
  return best;
}

// Heading of the way to the exit: the furthest cell down the BFS path still in straight sight.
function route(L: Level, x: number, y: number) {
  let c = Math.floor(y) * N + Math.floor(x), aim = c;
  for (let i = 0; i < 8 && L.d[c] > 0; i++) {
    const n = [c - 1, c + 1, c - N, c + N].find((n) => n >= 0 && n < N * N && L.d[n] >= 0 && L.d[n] < L.d[c]);
    if (n === undefined) break;
    c = n;
    if (L.d[c] === 0 || sight(L, x, y, (c % N) + 0.5, Math.floor(c / N) + 0.5)) aim = c;
    if (L.d[c] === 0) break;
  }
  return Math.atan2(Math.floor(aim / N) + 0.5 - y, (aim % N) + 0.5 - x);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clone = (s: S): S => ({ ...s, taken: [...s.taken], enemies: s.enemies.map((e) => ({ ...e })), shots: s.shots.map((p) => ({ ...p })), poses: [] });

function rand(s: S) { const [v, n] = next(s.rng); s.rng = n; return v; }

function damage(s: S, n: number) {
  const soak = Math.min(s.armor, Math.floor(n / 3));
  s.armor -= soak; s.hp = Math.max(0, s.hp - (n - soak)); s.hurtAt = s.t;
}

// The enemy the crosshair is on: nearest living one in sight within a narrow cone.
function target(L: Level, s: S) {
  let best = -1, bd = Infinity;
  s.enemies.forEach((e, i) => {
    if (e.hp <= 0) return;
    const d = Math.hypot(e.x - s.x, e.y - s.y);
    if (Math.abs(wrap(Math.atan2(e.y - s.y, e.x - s.x) - s.a)) < Math.atan2(0.3, d) + 0.05 && d < bd && sight(L, s.x, s.y, e.x, e.y)) { best = i; bd = d; }
  });
  return best;
}

function nextLevel(s: S) {
  s.level++; s.levels++;
  const L = level(s.seed, s.level);
  [s.x, s.y, s.a] = L.start;
  s.enemies = L.enemies.map((e) => ({ ...e })); s.shots = []; s.taken = []; s.levelAt = s.t;
  s.poses = [[s.x, s.y, s.a]];
}

function frame(s: S, act: Act, f: number, hunt: Int16Array) {
  const L = level(s.seed, s.level);
  if (act === 'left') s.a = wrap(s.a - TURN);
  if (act === 'right') s.a = wrap(s.a + TURN);
  const c = Math.cos(s.a), sn = Math.sin(s.a);
  const [fw, st] = act === 'fwd' || act === 'ff' ? [RUN, 0] : act === 'left' || act === 'right' ? [RUN * 0.6, 0] : act === 'back' ? [-STRAFE, 0] : act === 'sl' ? [0, -STRAFE] : act === 'sr' ? [0, STRAFE] : [0, 0];
  const dx = c * fw - sn * st, dy = sn * fw + c * st;
  const free = (x: number, y: number) => !blocked(L, x, y) && !s.enemies.some((e) => e.hp > 0 && Math.hypot(e.x - x, e.y - y) < 0.5);
  if (free(s.x + dx, s.y)) s.x += dx;
  if (free(s.x, s.y + dy)) s.y += dy;
  if (f === 0 && (act === 'fire' || act === 'ff' || (act === 'aim' && target(L, s) >= 0)) && s.ammo > 0) {
    s.ammo--; s.fired = s.t;
    const i = target(L, s);
    if (i >= 0) {
      const e = s.enemies[i];
      e.hp -= 10 + Math.floor(rand(s) * 8); e.awake = true; e.hurt = s.t; e.cd = Math.max(e.cd, 12);
      if (e.hp <= 0) { e.died = s.t; s.kills++; }
    }
  }
  L.items.forEach(([x, y, k], i) => {
    if (s.taken.includes(i) || Math.hypot(x - s.x, y - s.y) > 0.5) return;
    s.taken.push(i); s.pickups++;
    if (k === 0) s.hp = Math.min(100, s.hp + 25);
    if (k === 1) s.hp = Math.min(100, s.hp + 10);
    if (k === 2) s.ammo = Math.min(200, s.ammo + 10);
    if (k === 3) s.armor = Math.min(100, s.armor + 50);
  });
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const ex = s.x - e.x, ey = s.y - e.y, d = Math.hypot(ex, ey);
    const los = d < 14 && sight(L, e.x, e.y, s.x, s.y);
    if (!e.awake && ((los && d < 10) || (s.fired === s.t - 1 && d < 10))) { e.awake = true; e.cd = 60 + Math.floor(rand(s) * 40); } // sight or gunfire, then a reaction delay
    if (!e.awake) continue;
    e.cd--;
    if (los && e.cd <= 0) {
      e.atk = s.t; e.cd = KIND[e.k].reload + Math.floor(rand(s) * 40);
      if (e.k === 0) { if (rand(s) < 0.8 - d * 0.04) damage(s, 3 + Math.floor(rand(s) * 10)); }
      else s.shots.push({ x: e.x, y: e.y, vx: (ex / d) * (4 / 60), vy: (ey / d) * (4 / 60), born: s.t, end: -1 });
    }
    if (s.t - e.atk < 12 || d < 1.2) continue; // standing to attack, or close enough
    // Straight at the player when in sight, otherwise one cell down the path toward them.
    let gx = s.x, gy = s.y;
    if (!los) {
      const c = Math.floor(e.y) * N + Math.floor(e.x);
      const n = [c - 1, c + 1, c - N, c + N].find((n) => hunt[n] >= 0 && hunt[n] < hunt[c]);
      if (n !== undefined) { gx = (n % N) + 0.5; gy = Math.floor(n / N) + 0.5; }
    }
    const gd = Math.hypot(gx - e.x, gy - e.y) || 1, v = KIND[e.k].speed, mx = ((gx - e.x) / gd) * v, my = ((gy - e.y) / gd) * v;
    const ok = (x: number, y: number) => !blocked(L, x, y) && !s.enemies.some((o) => o !== e && o.hp > 0 && Math.hypot(o.x - x, o.y - y) < 0.5);
    if (ok(e.x + mx, e.y)) e.x += mx;
    if (ok(e.x, e.y + my)) e.y += my;
  }
  for (const p of s.shots) {
    if (p.end >= 0) continue;
    p.x += p.vx; p.y += p.vy;
    if (Math.hypot(p.x - s.x, p.y - s.y) < 0.4) { damage(s, 8 + Math.floor(rand(s) * 10)); p.end = s.t; }
    else if (solid(L, p.x, p.y)) p.end = s.t;
  }
  s.t++;
  if (Math.hypot(s.x - ((L.exit % N) + 0.5), s.y - (Math.floor(L.exit / N) + 0.5)) < 0.9) nextLevel(s);
}

function run(s0: S, act: Act) {
  const s = clone(s0);
  s.shots = s.shots.filter((p) => p.end < 0);
  for (const e of s.enemies) { e.px = e.x; e.py = e.y; }
  const lv = s.level, L = level(s.seed, s.level), hunt = bfs(L.g, [Math.floor(s.y) * N + Math.floor(s.x)]);
  for (let f = 0; f < FRAMES && s.hp > 0; f++) {
    frame(s, act, f, hunt);
    if (s.level !== lv) break;
    s.poses.push([s.x, s.y, s.a]);
  }
  s.turns++;
  return s;
}

const isAct = (a: string): a is Move => (ACTS as string[]).includes(a);
const over = (s: S) => s.hp <= 0 || s.turns >= MAX_TURNS;
const m = (cells: number) => `${(cells * M).toFixed(1)} m`;
const bearing = (s: S, x: number, y: number) => {
  const b = Math.round((wrap(Math.atan2(y - s.y, x - s.x) - s.a) * 180) / Math.PI);
  return Math.abs(b) <= 3 ? 'dead ahead' : `${Math.abs(b)}° ${b < 0 ? 'left' : 'right'}`;
};

// One second: the option for one step, then holding fire on whatever is in the crosshair, enemies included.
function lookahead(s: S, act: Move) {
  let r = s;
  for (let i = 0; i < LOOK_STEPS && !over(r) && r.level === s.level; i++) r = run(r, i ? 'aim' : act);
  return r;
}

const LABEL: Record<Move, string> = { ff: '↑✹ Advance + fire', fwd: '↑ Forward', fire: '✹ Fire', left: '↺ Turn left', right: '↻ Turn right', sl: '⇠ Strafe left', sr: '⇢ Strafe right', back: '↓ Back' };
const VERB: Record<Move, string> = {
  ff: 'Advance one stride firing', fwd: 'Advance one stride', fire: 'Stand and fire',
  left: 'Turn left 45° while walking', right: 'Turn right 45° while walking',
  sl: 'Strafe left one stride', sr: 'Strafe right one stride', back: 'Back off one stride',
};

function detail(s: S, act: Move) {
  const r = lookahead(s, act), L = level(s.seed, s.level);
  const parts: string[] = [];
  const shots = s.ammo - r.ammo;
  const hits = r.enemies.filter((e, i) => r.level === s.level && e.hurt >= s.t && s.enemies[i].hp > 0);
  if (hits.length) parts.push(`${shots} shots hit the ${hits.map((e) => KIND[e.k].name).join(' and the ')}`);
  else if (act === 'fire' || act === 'ff') parts.push(shots ? `${shots} shots, all miss` : 'out of ammo');
  const killed = r.kills - s.kills;
  if (killed) parts.push(`kills ${killed} (${r.enemies.filter((e, i) => e.hp <= 0 && s.enemies[i].hp > 0).map((e) => `${KIND[e.k].name} at ${m(Math.hypot(e.x - s.x, e.y - s.y))}`).join(', ')})`);
  parts.push(r.hp <= 0 ? `you die (health ${s.hp} → 0)` : r.hp < s.hp || r.armor < s.armor ? `you take damage, health ${s.hp} → ${r.hp}` : 'you take 0 damage');
  if (r.level !== s.level) parts.push('reaches the exit switch: level complete');
  else {
    const a = toExit(L, s.x, s.y), b = toExit(L, r.x, r.y), moved = Math.hypot(r.x - s.x, r.y - s.y);
    if (moved < 0.05 && act !== 'fire') parts.push('blocked, does not move');
    parts.push(Math.abs(a - b) < 0.05 ? `exit stays ${m(b)} away` : `${m(Math.abs(a - b))} ${b < a ? 'closer to' : 'further from'} the exit (now ${m(b)})`);
    const off = Math.round((Math.abs(wrap(route(L, r.x, r.y) - r.a)) * 180) / Math.PI);
    parts.push(off <= 10 ? 'ends facing the way to the exit' : `ends facing ${off}° off the way to the exit`);
  }
  const got = r.taken.filter((i) => !s.taken.includes(i)).map((i) => ITEMS[L.items[i][2]].name);
  if (got.length && r.level === s.level) parts.push(`picks up ${got.join(', ')}`);
  return `${VERB[act]}, then hold fire for the rest of the second: ${parts.join('; ')}.`;
}

export const freedoom: Game<S> = {
  id: 'freedoom',
  title: 'Freedoom',
  blurb: 'Shoot the zombies and imps, find the exit.',
  accent: '#84cc16',
  instruction: 'Which move kills the monsters and keeps you alive while making progress to the exit switch? Each option shows the next second: the move, then firing at whatever is in your sights.',
  stepMs: (FRAMES * 1000) / 60,
  realtime: true,
  init(seed) {
    const s0 = seed | 0, L = level(s0, 1);
    const [x, y, a] = L.start;
    return {
      seed: s0, level: 1, rng: s0 ^ 0x5bd1e995, t: 0, turns: 0, x, y, a, hp: 100, armor: 0, ammo: 50,
      kills: 0, levels: 0, pickups: 0, taken: [], enemies: L.enemies.map((e) => ({ ...e })), shots: [],
      poses: [[x, y, a]], fired: -99, hurtAt: -99, levelAt: 0,
    };
  },
  isState(v): v is S {
    const s = v as S;
    return !!s && typeof s === 'object' && ['seed', 'level', 'rng', 't', 'turns', 'hp', 'armor', 'ammo', 'kills', 'levels', 'pickups', 'fired', 'hurtAt', 'levelAt'].every((k) => isInt(s[k as keyof S])) &&
      ['x', 'y', 'a'].every((k) => Number.isFinite(s[k as keyof S])) && s.level >= 1 && s.level < 1000 &&
      Array.isArray(s.taken) && s.taken.every(isInt) && Array.isArray(s.poses) && Array.isArray(s.shots) && s.shots.length < 100 &&
      Array.isArray(s.enemies) && s.enemies.length <= 10 &&
      s.enemies.every((e) => !!e && (e.k === 0 || e.k === 1) && ['x', 'y', 'px', 'py'].every((k) => Number.isFinite(e[k as keyof Enemy])) && typeof e.awake === 'boolean' && ['hp', 'cd', 'atk', 'died', 'hurt'].every((k) => isInt(e[k as keyof Enemy]))) &&
      s.shots.every((p) => !!p && ['x', 'y', 'vx', 'vy'].every((k) => Number.isFinite(p[k as keyof Shot])) && isInt(p.born) && isInt(p.end));
  },
  describe(s) {
    const L = level(s.seed, s.level);
    const seen = s.enemies.filter((e) => e.hp > 0 && sight(L, s.x, s.y, e.x, e.y))
      .map((e) => `${KIND[e.k].name} ${m(Math.hypot(e.x - s.x, e.y - s.y))} ${bearing(s, e.x, e.y)}${e.awake ? '' : ' (has not seen you)'}`);
    const fire = s.shots.filter((p) => p.end < 0 && sight(L, s.x, s.y, p.x, p.y)).map((p) => `fireball ${m(Math.hypot(p.x - s.x, p.y - s.y))} ${bearing(s, p.x, p.y)}`);
    const ex = (L.exit % N) + 0.5, ey = Math.floor(L.exit / N) + 0.5;
    return `Level ${s.level}. Health ${s.hp}, armor ${s.armor}, ammo ${s.ammo}. Kills ${s.kills}, ${s.enemies.filter((e) => e.hp > 0).length} monsters left on this level. ` +
      `In sight: ${[...seen, ...fire].join('; ') || 'nothing'}. Exit switch ${m(toExit(L, s.x, s.y))} away by path, straight line ${bearing(s, ex, ey)}. Turn ${s.turns} of ${MAX_TURNS}.`;
  },
  options: (s) => ACTS.map((act): Option => ({ id: act, label: LABEL[act], detail: detail(s, act) })),
  step: (s, action) => run(s, isAct(action) ? action : 'fire'),
  over,
  score: (s) => s.kills * 100 + s.levels * 1000 + s.pickups * 10,
  render: (ctx, s, w, h, t) => draw(ctx, s, w, h, t),
};

// ---------- rendering (browser only) ----------

const imgs: Record<string, HTMLImageElement> = {};
const texels: Record<string, Uint32Array> = {};
let redraw: (() => void) | null = null, queued = false;
function img(n: string) {
  if (typeof window === 'undefined') return null;
  let i = imgs[n];
  if (!i) {
    i = imgs[n] = new Image();
    i.onload = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; redraw?.(); }); } };
    i.src = `/games/freedoom/${n}.png`;
  }
  return i.complete && i.naturalWidth ? i : null;
}
function pixels(n: string) { // a 64x64 flat as RGBA words, for floor casting
  if (texels[n]) return texels[n];
  const i = img(n);
  if (!i) return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; g.drawImage(i, 0, 0);
  return (texels[n] = new Uint32Array(g.getImageData(0, 0, 64, 64).data.buffer));
}
const WALL = ['', 'brick1', 'stonew1', 'brown1'];
const WALL_RGB = ['', '#6b6b6b', '#8a8a80', '#5a4630'];
let buf: { c: HTMLCanvasElement; w: number; h: number; data: ImageData } | null = null;

function draw(ctx: CanvasRenderingContext2D, s: S, w: number, h: number, t: number) {
  redraw = () => draw(ctx, s, w, h, t);
  const L = level(s.seed, s.level);
  const k = s.poses.length ? Math.min(s.poses.length - 1, Math.floor(t * s.poses.length)) : 0;
  const [px, py, pa] = s.poses[k] ?? [s.x, s.y, s.a];
  const now = s.t - (s.poses.length - 1 - k); // the frame being shown
  const hud = Math.round(Math.max(44, h * 0.12)), vh = h - hud, hor = vh / 2;
  const cols = Math.min(320, Math.ceil(w / 2)), cw = w / cols, focal = w / 2 / FOV;
  const dx = Math.cos(pa), dy = Math.sin(pa), plx = -dy * FOV, ply = dx * FOV;
  ctx.imageSmoothingEnabled = false;

  // floor and ceiling, cast at low resolution into an offscreen buffer
  const bw = cols, bh = Math.max(2, Math.round((vh * cols) / w));
  const fl = pixels('floor0_1'), ce = pixels('ceil1_1');
  if (fl && ce) {
    if (!buf || buf.w !== bw || buf.h !== bh) {
      const c = document.createElement('canvas'); c.width = bw; c.height = bh;
      buf = { c, w: bw, h: bh, data: c.getContext('2d')!.createImageData(bw, bh) };
    }
    const out = new Uint32Array(buf.data.data.buffer), fb = focal * (bw / w);
    for (let y = 0; y < bh; y++) {
      const off = Math.abs(y + 0.5 - bh / 2), dist = fb / (2 * off), shade = Math.max(0.15, Math.min(1, 1.6 / (dist + 0.8)));
      const tex = y < bh / 2 ? ce : fl;
      for (let x = 0; x < bw; x++) {
        const cx = (2 * (x + 0.5)) / bw - 1, wx = px + (dx + plx * cx) * dist, wy = py + (dy + ply * cx) * dist;
        const p = tex[((Math.floor((wy - Math.floor(wy)) * 64) & 63) << 6) | (Math.floor((wx - Math.floor(wx)) * 64) & 63)];
        out[y * bw + x] = (0xff << 24) | (((((p >> 16) & 255) * shade) & 255) << 16) | (((((p >> 8) & 255) * shade) & 255) << 8) | (((p & 255) * shade) & 255);
      }
    }
    buf.c.getContext('2d')!.putImageData(buf.data, 0, 0);
    ctx.drawImage(buf.c, 0, 0, w, vh);
  } else {
    ctx.fillStyle = '#26221e'; ctx.fillRect(0, 0, w, hor);
    ctx.fillStyle = '#3b3024'; ctx.fillRect(0, hor, w, vh - hor);
  }

  // walls, one ray per column (DDA)
  const zbuf = new Float32Array(cols);
  for (let i = 0; i < cols; i++) {
    const cx = (2 * (i + 0.5)) / cols - 1, rx = dx + plx * cx, ry = dy + ply * cx;
    let mx = Math.floor(px), my = Math.floor(py);
    const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
    let tx = (rx < 0 ? px - mx : mx + 1 - px) * ddx, ty = (ry < 0 ? py - my : my + 1 - py) * ddy, side = 0, cell = 0;
    for (let n = 0; n < 64 && !cell; n++) {
      if (tx < ty) { tx += ddx; mx += sx; side = 0; } else { ty += ddy; my += sy; side = 1; }
      cell = mx < 0 || my < 0 || mx >= N || my >= N ? 1 : L.g[my * N + mx];
    }
    const dist = Math.max(0.05, side ? ty - ddy : tx - ddx);
    zbuf[i] = dist;
    const lh = focal / dist, top = hor - lh / 2;
    let u = side ? px + dist * rx : py + dist * ry; u -= Math.floor(u);
    if ((side === 0 && rx > 0) || (side === 1 && ry < 0)) u = 1 - u;
    const tex = img(cell === EXIT ? 'door2_1' : WALL[cell] || 'brick1');
    if (tex) ctx.drawImage(tex, Math.floor(u * tex.width), 0, 1, tex.height, i * cw, top, cw + 0.6, lh);
    else { ctx.fillStyle = cell === EXIT ? '#3f7d3a' : WALL_RGB[cell] || '#666'; ctx.fillRect(i * cw, top, cw + 0.6, lh); }
    const dark = Math.min(0.85, 1 - Math.min(1, 1.8 / (dist + 0.8)) + (side ? 0.12 : 0));
    if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(i * cw, top, cw + 0.6, lh); }
  }

  // sprites: pickups, monsters, fireballs, far to near, clipped per column against the walls
  type Spr = { x: number; y: number; name: string; fb: string; scale: number; lift: number };
  const sprites: Spr[] = [];
  L.items.forEach(([x, y, kind], i) => { if (!s.taken.includes(i)) sprites.push({ x, y, name: ITEMS[kind].img, fb: '#4ade80', scale: 1 / 80, lift: 0 }); });
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(1, (k + 1) / Math.max(1, s.poses.length));
  for (const e of s.enemies) {
    const pre = e.k ? 'troo' : 'poss', since = now - e.died;
    let name: string;
    if (e.died >= 0 && since >= 0) name = pre + (e.k ? 'ijklm' : 'hijkl')[Math.min(4, Math.floor(since / 5))] + '0';
    else if (now - e.atk >= 0 && now - e.atk < 12) name = pre + (e.k ? 'efg' : 'eff')[Math.min(2, Math.floor((now - e.atk) / 4))] + '1';
    else name = pre + 'abcd'[e.awake ? Math.floor(now / 8) % 4 : 0] + '1';
    sprites.push({ x: lerp(e.px, e.x), y: lerp(e.py, e.y), name, fb: e.k ? '#b45309' : '#65a30d', scale: 1 / 80, lift: 0 });
  }
  for (const p of s.shots) {
    const back = s.t - now;
    if (now < p.born) continue;
    if (p.end >= 0 && now >= p.end) { if (now - p.end < 9) sprites.push({ x: p.x, y: p.y, name: 'bal1' + 'cde'[Math.floor((now - p.end) / 3)] + '0', fb: '#fbbf24', scale: 1 / 200, lift: 0.3 }); continue; }
    const behind = p.end >= 0 ? p.end - now : back;
    sprites.push({ x: p.x - p.vx * behind, y: p.y - p.vy * behind, name: 'bal1' + 'ab'[Math.floor(now / 4) % 2] + '0', fb: '#f97316', scale: 1 / 50, lift: 0.3 });
  }
  const depth = (o: Spr) => (o.x - px) * dx + (o.y - py) * dy;
  sprites.sort((a, b) => depth(b) - depth(a));
  for (const o of sprites) {
    const z = depth(o);
    if (z < 0.2) continue;
    const lat = ((o.x - px) * -dy + (o.y - py) * dx) / FOV, sxc = (w / 2) * (1 + lat / z), unit = focal / z;
    const im = img(o.name), iw = im ? im.width : 40, ih = im ? im.height : 56;
    const sw = iw * o.scale * unit, sh = ih * o.scale * unit, bottom = hor + unit / 2 - o.lift * unit, x0 = sxc - sw / 2;
    for (let c = Math.max(0, Math.floor(x0 / cw)); c < Math.min(cols, Math.ceil((x0 + sw) / cw)); c++) {
      if (zbuf[c] < z) continue;
      const u = Math.min(iw - 1, Math.max(0, Math.floor(((c * cw - x0) / sw) * iw)));
      if (im) ctx.drawImage(im, u, 0, 1, ih, c * cw, bottom - sh, cw + 0.6, sh);
      else { ctx.fillStyle = o.fb; ctx.fillRect(c * cw, bottom - sh, cw + 0.6, sh); }
    }
  }

  // weapon, bobbing while moving, recoiling and flashing when fired
  const since = now - s.fired, moving = k > 0 && Math.hypot(px - s.poses[k - 1][0], py - s.poses[k - 1][1]) > 0.001;
  const gun = img(since >= 0 && since < 4 ? 'pisgb0' : since >= 4 && since < 9 ? 'pisgc0' : 'pisga0');
  const gs = Math.min(w / 320, vh / 170) * 1.25, bob = moving ? Math.sin(now / 5) * 6 * gs : 0;
  if (gun) {
    if (since >= 0 && since < 4) { const fl2 = img('pisfa0'); if (fl2) ctx.drawImage(fl2, w / 2 - (fl2.width * gs) / 2, vh - gun.height * gs - fl2.height * gs * 0.7, fl2.width * gs, fl2.height * gs); }
    ctx.drawImage(gun, w / 2 - (gun.width * gs) / 2 + bob, vh - gun.height * gs + Math.abs(bob) * 0.5, gun.width * gs, gun.height * gs);
  } else { ctx.fillStyle = '#444'; ctx.fillRect(w / 2 - 20 * gs, vh - 50 * gs, 40 * gs, 50 * gs); }
  ctx.fillStyle = '#fff8'; ctx.fillRect(w / 2 - 1, hor - 6, 2, 12); ctx.fillRect(w / 2 - 6, hor - 1, 12, 2);

  // damage tint, level banner, death
  if (now - s.hurtAt >= 0 && now - s.hurtAt < 10) { ctx.fillStyle = `rgba(200,0,0,${0.35 * (1 - (now - s.hurtAt) / 10)})`; ctx.fillRect(0, 0, w, vh); }
  const big = Math.max(18, Math.min(w, vh) / 12);
  ctx.textAlign = 'center'; ctx.font = `900 ${big}px ui-monospace, monospace`;
  if (s.hp <= 0) {
    ctx.fillStyle = 'rgba(120,0,0,0.55)'; ctx.fillRect(0, 0, w, vh);
    ctx.fillStyle = '#fecaca'; ctx.fillText('YOU DIED', w / 2, hor);
  } else if (s.t - s.levelAt < 45 && s.levelAt > 0) {
    ctx.fillStyle = '#000a'; ctx.fillRect(0, hor - big * 1.8, w, big * 1.4);
    ctx.fillStyle = '#facc15'; ctx.fillText(`LEVEL ${s.level}`, w / 2, hor - big * 0.75);
  }

  // automap
  const cs = Math.max(2, Math.floor(Math.min(w, vh) / 110)), ox = 8, oy = 8;
  ctx.fillStyle = '#0009'; ctx.fillRect(ox - 2, oy - 2, N * cs + 4, N * cs + 4);
  for (let c = 0; c < N * N; c++) {
    const g = L.g[c];
    if (g === 0) continue;
    const x = c % N, y = Math.floor(c / N), open = [c - 1, c + 1, c - N, c + N].some((n) => n >= 0 && n < N * N && L.g[n] === 0 && Math.abs((n % N) - x) <= 1);
    if (!open) continue;
    ctx.fillStyle = g === EXIT ? '#22c55e' : '#a16207'; ctx.fillRect(ox + x * cs, oy + y * cs, cs, cs);
  }
  for (const e of s.enemies) if (e.hp > 0) { ctx.fillStyle = '#ef4444'; ctx.fillRect(ox + e.x * cs - 1, oy + e.y * cs - 1, 3, 3); }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(ox + px * cs, oy + py * cs); ctx.lineTo(ox + (px + dx * 1.5) * cs, oy + (py + dy * 1.5) * cs); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(ox + px * cs - 1.5, oy + py * cs - 1.5, 3, 3);

  // status bar
  const bar = ctx.createLinearGradient(0, vh, 0, h);
  bar.addColorStop(0, '#5b5b5b'); bar.addColorStop(1, '#2e2e2e');
  ctx.fillStyle = bar; ctx.fillRect(0, vh, w, hud);
  ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, vh, w, 2);
  const cells: [string, string][] = [['AMMO', `${s.ammo}`], ['HEALTH', `${s.hp}%`], ['ARMOR', `${s.armor}%`], ['KILLS', `${s.kills}`], ['LEVEL', `${s.level}`]];
  const colw = w / cells.length, num = Math.min(hud * 0.52, colw / 3.6), lab = Math.max(8, num * 0.34);
  cells.forEach(([name, val], i) => {
    const cx = colw * (i + 0.5);
    if (i) { ctx.fillStyle = '#0006'; ctx.fillRect(colw * i - 1, vh + 6, 2, hud - 12); }
    ctx.font = `900 ${num}px ui-monospace, monospace`;
    ctx.fillStyle = '#000'; ctx.fillText(val, cx + 2, vh + hud * 0.58 + 2);
    ctx.fillStyle = name === 'HEALTH' && s.hp <= 25 ? '#ff5050' : '#d62c1f'; ctx.fillText(val, cx, vh + hud * 0.58);
    ctx.font = `700 ${lab}px ui-sans-serif, system-ui`; ctx.fillStyle = '#d4d4d4'; ctx.fillText(name, cx, vh + hud * 0.88);
  });
  ctx.textAlign = 'left';
}
