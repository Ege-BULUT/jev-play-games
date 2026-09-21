import type { Game, Option } from './types';
import { isInt, next } from './rng';

// Side-scrolling platformer. Coordinates are in tiles: x grows right, y grows down, the player's
// x/y is the top-left of its box. The level layout is derived from the level seed (rng) and never
// stored; the state keeps only the player, counters and what has been taken or killed.
const H = 14, GY = 12, W = 170;        // rows, ground surface row, level width in columns
const FRAMES = 15, TURNS = 1200;       // physics frames per decision (60 Hz), decisions per game
const PW = 0.7, PH = 0.9, EW = 0.8, EH = 0.8;
const VMAX = 0.13, ACC = 0.012, JV = 0.38, G_LO = 0.015, G_HI = 0.04, VY_MAX = 0.45, E_SPEED = 0.025;
const EMPTY = 0, GROUND = 1, BRICK = 2, BONUS = 3, PLANK = 4, CRATE = 5;

type Level = { t: Uint8Array; coins: [number, number][]; bonus: number[]; enemies: [number, number][]; flag: number };
type S = {
  rng: number; lv: number; f: number;               // level seed, level number (1..), frames played
  x: number; y: number; vx: number; vy: number; face: number; on: boolean;
  lives: number; coins: number; kills: number; base: number; best: number; safe: number; inv: number;
  got: number[]; bumped: number[]; dead: number[];  // indices into the level's coins, bonus blocks, enemies
  poses: number[];                                  // player x,y at the start and after each frame of the last turn
};

// dir: -1/0/1, jump: frames the jump button is held once the jump starts (0 = no jump)
const ACT: Record<string, { dir: number; jump: number; label: string; verb: string }> = {
  right: { dir: 1, jump: 0, label: '→ Run', verb: 'Run right' },
  hop: { dir: 1, jump: 4, label: '↗ Hop', verb: 'Run right and hop (short jump)' },
  leap: { dir: 1, jump: FRAMES, label: '⤴ Long jump', verb: 'Run right and long jump' },
  left: { dir: -1, jump: 0, label: '← Back', verb: 'Run left' },
  up: { dir: 0, jump: FRAMES, label: '↑ Jump', verb: 'Jump in place' },
  wait: { dir: 0, jump: 0, label: '· Wait', verb: 'Wait' },
};

const cache = new Map<string, Level>();
function level(seed: number, lv: number): Level {
  const key = `${seed}:${lv}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let r = seed;
  const rand = () => { const [v, s] = next(r); r = s; return v; };
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const t = new Uint8Array(W * H);
  const set = (x: number, y: number, k: number) => { t[y * W + x] = k; };
  const pit = (x: number, w: number) => { for (let i = x; i < x + w; i++) for (let y = GY; y < H; y++) set(i, y, EMPTY); };
  const coins: [number, number][] = [], enemies: [number, number][] = [];
  for (let x = 0; x < W; x++) for (let y = GY; y < H; y++) set(x, y, GROUND);
  let x = 12;
  while (x < W - 22) {
    const k = rand();
    if (k < 0.2) {
      const w = int(2, lv >= 3 ? 4 : 3);
      pit(x, w); coins.push([x + (w >> 1), GY - 4]); x += w;
    } else if (k < 0.34) {
      for (let y = GY - int(2, 3); y < GY; y++) set(x, y, CRATE);
      x += 4; // room to land before the next feature
    } else if (k < 0.56) {
      const n = int(6, 9);
      enemies.push([x + 1, x + n - 1 - EW]); // patrols this flat stretch
      if (lv >= 2 && n >= 8) enemies.push([x + 2, x + n - 1 - EW]);
      x += n;
    } else if (k < 0.74) {
      const n = int(3, 5), b = int(0, n - 1);
      for (let i = 0; i < n; i++) { set(x + 1 + i, GY - 4, i === b ? BONUS : BRICK); coins.push([x + 1 + i, GY - 5]); }
      x += n + 2;
    } else if (k < 0.87) {
      pit(x, 6);
      for (let i = 1; i < 5; i++) { set(x + i, GY - 3, PLANK); if (i > 1 && i < 4) coins.push([x + i, GY - 4]); }
      x += 6;
    } else {
      for (let i = 1; i < 5; i++) coins.push([x + i, GY - 3]);
      x += 5;
    }
    x += int(2, 4); // flat ground before the next feature
  }
  const bonus: number[] = [];
  t.forEach((k, i) => { if (k === BONUS) bonus.push(i); });
  const lvl = { t, coins, bonus, enemies, flag: W - 8 };
  if (cache.size > 64) cache.clear();
  cache.set(key, lvl);
  return lvl;
}

const tile = (L: Level, c: number, r: number) => (c < 0 ? GROUND : c >= W || r < 0 || r >= H ? EMPTY : L.t[r * W + c]);
const solid = (L: Level, c: number, r: number) => tile(L, c, r) !== EMPTY;
const span = (a: number, len: number) => [Math.floor(a), Math.floor(a + len - 1e-6)];
const colHit = (L: Level, c: number, y: number) => { const [a, b] = span(y, PH); for (let r = a; r <= b; r++) if (solid(L, c, r)) return true; return false; };
const rowHit = (L: Level, x: number, r: number) => { const [a, b] = span(x, PW); for (let c = a; c <= b; c++) if (solid(L, c, r)) return c; return -1; };
// Enemies walk back and forth over their stretch; position is a pure function of the frame.
function ex(L: Level, i: number, f: number) {
  const [a, b] = L.enemies[i], d = b - a, p = ((f + i * 37) * E_SPEED) % (2 * d);
  return b - (p < d ? p : 2 * d - p);
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const col = (x: number) => Math.floor(x + PW / 2);
const done = (s: S) => s.lives <= 0 || s.f >= FRAMES * TURNS;

// One decision: hold the action's input for FRAMES frames. Returns the new state and what happened.
function run(s: S, id: string): { w: S; ev: string[] } {
  const inp = ACT[id] ?? ACT.wait;
  const w: S = { ...s, got: [...s.got], bumped: [...s.bumped], dead: [...s.dead], poses: [r2(s.x), r2(s.y)] };
  const ev: string[] = [];
  let L = level(w.rng, w.lv), hold = w.on ? 0 : inp.jump, jumped = false;
  const hurt = (why: string) => {
    w.lives--; ev.push(`${why} and loses a life${w.lives ? '' : ' (game over)'}`);
    Object.assign(w, { x: w.safe, y: GY - PH, vx: 0, vy: 0, on: true, inv: 90 });
  };
  for (let i = 0; i < FRAMES; i++) {
    if (done(w)) { w.poses.push(r2(w.x), r2(w.y)); continue; }
    w.f++;
    if (w.inv) w.inv--;
    if (inp.dir) w.face = inp.dir;
    w.vx += Math.max(-ACC, Math.min(ACC, inp.dir * VMAX - w.vx));
    if (inp.jump && !jumped && w.on) { w.vy = -JV; jumped = true; hold = inp.jump; }
    w.vy = Math.min(VY_MAX, w.vy + (w.vy < 0 && hold > 0 ? G_LO : G_HI));
    if (hold) hold--;
    w.x += w.vx;
    if (w.vx > 0) { const c = Math.floor(w.x + PW - 1e-6); if (colHit(L, c, w.y)) { w.x = c - PW; w.vx = 0; } }
    else if (w.vx < 0) { const c = Math.floor(w.x); if (colHit(L, c, w.y)) { w.x = c + 1; w.vx = 0; } }
    const prevBottom = w.y + PH;
    w.y += w.vy; w.on = false;
    if (w.vy > 0) {
      const r = Math.floor(w.y + PH - 1e-6);
      if (rowHit(L, w.x, r) >= 0) { w.y = r - PH; w.vy = 0; w.on = true; }
    } else if (w.vy < 0) {
      const r = Math.floor(w.y), c = rowHit(L, w.x, r);
      if (c >= 0) {
        w.y = r + 1; w.vy = 0;
        const [a, b] = span(w.x, PW);
        for (let cc = a; cc <= b; cc++) {
          const k = L.bonus.indexOf(r * W + cc);
          if (k >= 0 && !w.bumped.includes(k)) { w.bumped.push(k); w.coins++; ev.push(`bumps the bonus block at column ${cc} (+1 coin)`); }
        }
      }
    }
    if (w.on && tile(L, Math.floor(w.x), GY) === GROUND && tile(L, Math.floor(w.x + PW - 1e-6), GY) === GROUND && Math.abs(w.y + PH - GY) < 1e-6) w.safe = w.x;
    L.coins.forEach(([cx, cy], k) => {
      if (!w.got.includes(k) && w.x < cx + 0.75 && w.x + PW > cx + 0.25 && w.y < cy + 0.75 && w.y + PH > cy + 0.25) { w.got.push(k); w.coins++; }
    });
    for (let k = 0; k < L.enemies.length; k++) {
      if (w.dead.includes(k)) continue;
      const e = ex(L, k, w.f);
      if (w.x < e + EW && w.x + PW > e && w.y + PH > GY - EH && w.y < GY) {
        if (w.vy > 0 && prevBottom <= GY - EH + 0.25) {
          w.dead.push(k); w.kills++; w.vy = -0.28; ev.push(`stomps the enemy at column ${Math.floor(e + EW / 2)} (+50)`);
        } else if (!w.inv) { hurt(`runs into the enemy at column ${Math.floor(e + EW / 2)}`); break; }
      }
    }
    if (w.y > H) hurt(`falls into the pit at column ${col(w.x)}`);
    w.best = Math.max(w.best, Math.floor(w.base + w.x));
    if (w.x + PW >= L.flag + 0.3 && w.lives > 0) {
      ev.push(`reaches the flag: level ${w.lv} complete`);
      Object.assign(w, { base: w.base + L.flag, lv: w.lv + 1, rng: next(w.rng)[1], x: 2, y: GY - PH, vx: 0, vy: 0, on: true, safe: 2, got: [], bumped: [], dead: [] });
      L = level(w.rng, w.lv);
    }
    w.poses.push(r2(w.x), r2(w.y));
  }
  return { w, ev };
}

const moved = (d: number) => (Math.abs(d) < 0.05 ? 'stays put' : `moves ${Math.abs(d).toFixed(1)} tiles ${d > 0 ? 'right' : 'left'}`);
const pos = (s: S) => s.base + s.x;

// What holding this option for ~1 s (four decisions) leads to, stated as facts for Jev.
function preview(s: S, id: string): string {
  const L = level(s.rng, s.lv), ev: string[] = [];
  let w = s, first = 0;
  for (let k = 0; k < 4 && !done(w); k++) {
    const r = run(w, id);
    ev.push(...r.ev);
    w = r.w;
    if (k === 0) first = pos(w) - pos(s);
    if (w.lives < s.lives || w.lv !== s.lv) break;
  }
  const d = pos(w) - pos(s);
  const hurt = w.lives < s.lives;
  if (!hurt && w.lv === s.lv && d > 0) {
    const [a, b] = [col(s.x), col(w.x)];
    for (let c = a + 1; c <= b; c++) {
      if (tile(L, c, GY) === EMPTY && tile(L, c - 1, GY) !== EMPTY) ev.push(`clears the pit at column ${c}`);
      if (tile(L, c, GY - 1) === CRATE) ev.push(`gets over the crate pillar at column ${c}`);
    }
    L.enemies.forEach((_, k) => {
      if (!w.dead.includes(k) && ex(L, k, s.f) > s.x && ex(L, k, w.f) + EW < w.x) ev.push(`gets past the enemy at column ${Math.floor(ex(L, k, w.f))}`);
    });
  }
  const coins = w.coins - s.coins - ev.filter((e) => e.startsWith('bumps')).length;
  if (coins > 0) ev.push(`collects ${coins} coin${coins > 1 ? 's' : ''}`);
  const end = hurt ? '' : w.lv !== s.lv ? '' :
    w.on ? `, ends standing on ${['the ground', 'the ground', 'a brick block', 'a bonus block', 'a plank platform', 'a crate pillar'][tile(L, rowHit(L, w.x, Math.round(w.y + PH)), Math.round(w.y + PH))] ?? 'solid ground'}` : ', ends still in the air';
  return `${ACT[id].verb}: this turn ${moved(first)}; kept up for 1 s it ${moved(d)}, ending at column ${col(w.x)}${end}` +
    `${ev.length ? '; ' + ev.join(', ') : ''}${hurt ? '' : ev.length ? '' : ', nothing else happens'}.`;
}

const LEGEND = 'R runner, E enemy, o coin, # ground, B brick block, ? bonus block, = plank platform, H crate pillar, F goal flag, . air';
const CH = ['.', '#', 'B', '?', '=', 'H'];

export const jevbros: Game<S> = {
  id: 'jevbros',
  title: 'Super Jev Bros',
  blurb: 'Run, jump, stomp and grab coins through endless levels.',
  accent: '#ef4444',
  instruction: 'Which move gets the runner furthest right toward the goal flag without losing a life? Prefer moves that land safely, clear pits, stomp or get past enemies and collect coins; never pick a move that falls into a pit or runs into an enemy.',
  stepMs: 250,
  realtime: true,
  init(seed) {
    const s: S = {
      rng: seed | 0, lv: 1, f: 0, x: 2, y: GY - PH, vx: 0, vy: 0, face: 1, on: true,
      lives: 3, coins: 0, kills: 0, base: 0, best: 2, safe: 2, inv: 0, got: [], bumped: [], dead: [], poses: [],
    };
    for (let i = 0; i <= FRAMES; i++) s.poses.push(s.x, s.y);
    return s;
  },
  isState(v): v is S {
    const s = v as S;
    const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
    const ints = (a: unknown) => Array.isArray(a) && a.length <= 512 && a.every((n) => isInt(n) && n >= 0);
    return !!s && typeof s === 'object' && isInt(s.rng) && isInt(s.lv) && s.lv >= 1 && s.lv < 1e4 && isInt(s.f) && s.f >= 0 &&
      [s.x, s.y, s.vx, s.vy, s.base, s.safe].every(num) && Math.abs(s.x) < 1e3 && Math.abs(s.y) < 1e3 &&
      (s.face === 1 || s.face === -1) && typeof s.on === 'boolean' && isInt(s.lives) && s.lives >= 0 && s.lives <= 3 &&
      [s.coins, s.kills, s.best, s.inv].every((n) => isInt(n) && n >= 0) &&
      ints(s.got) && ints(s.bumped) && ints(s.dead) &&
      Array.isArray(s.poses) && s.poses.length === 2 * (FRAMES + 1) && s.poses.every(num);
  },
  describe(s) {
    const L = level(s.rng, s.lv), c0 = Math.max(0, col(s.x) - 4), c1 = Math.min(W, c0 + 30);
    const g = Array.from({ length: H - 4 }, (_, r) => Array.from({ length: c1 - c0 }, (_, c) => CH[tile(L, c0 + c, r + 4)]));
    const put = (c: number, r: number, ch: string) => { if (c >= c0 && c < c1 && r >= 4 && r < H) g[r - 4][c - c0] = ch; };
    L.coins.forEach(([cx, cy], k) => { if (!s.got.includes(k)) put(cx, cy, 'o'); });
    L.enemies.forEach((_, k) => { if (!s.dead.includes(k)) put(Math.floor(ex(L, k, s.f) + EW / 2), GY - 1, 'E'); });
    for (let r = 5; r < GY; r++) put(L.flag, r, 'F');
    put(col(s.x), Math.floor(s.y + PH / 2), 'R');
    return `Super Jev Bros, level ${s.lv}. Lives ${s.lives}, coins ${s.coins}, enemies stomped ${s.kills}, score ${jevbros.score(s)}. ` +
      `Runner at column ${col(s.x)}, ${s.on ? 'standing' : s.vy < 0 ? 'rising' : 'falling'}${s.inv ? ', briefly invulnerable' : ''}. ` +
      `Goal flag at column ${L.flag} (${L.flag - col(s.x)} columns ahead). Stomping an enemy from above kills it; touching it from the side costs a life, so does falling into a pit.\n` +
      `Map, columns ${c0}-${c1 - 1}, rows 4-${H - 1} (${LEGEND}):\n` + g.map((r) => r.join('')).join('\n');
  },
  options(s) {
    return Object.keys(ACT).map((id): Option => ({ id, label: ACT[id].label, detail: preview(s, id) }));
  },
  step(s, action) {
    return run(s, action).w;
  },
  over: done,
  score: (s) => s.coins * 10 + s.kills * 50 + s.best,
  render(ctx, s, w, h, t) { draw(ctx, s, w, h, t); },
};

// ---- rendering (browser only). Kenney "Pixel Platformer" sheets, CC0; primitives until loaded.
type Art = { tiles: HTMLImageElement; chars: HTMLImageElement; bg: HTMLImageElement };
let art: Art | null = null;
const waiting = new Map<CanvasRenderingContext2D, () => void>(); // canvases to redraw once the art arrives
const ready = () => !!art && Object.values(art).every((i) => i.complete && i.naturalWidth > 0);
function getArt(): Art | null {
  if (typeof window === 'undefined') return null;
  if (!art) {
    const img = (name: string) => {
      const i = new Image();
      i.onload = () => { if (ready()) { waiting.forEach((redraw) => redraw()); waiting.clear(); } };
      i.src = `/games/jevbros/${name}.png`;
      return i;
    };
    art = { tiles: img('tiles'), chars: img('characters'), bg: img('backgrounds') };
  }
  return ready() ? art : null;
}

function sprite(ctx: CanvasRenderingContext2D, im: HTMLImageElement, size: number, cols: number, idx: number, x: number, y: number, dw: number, dh: number, flip = false) {
  const sx = (idx % cols) * size, sy = Math.floor(idx / cols) * size;
  if (!flip) { ctx.drawImage(im, sx, sy, size, size, x, y, dw, dh); return; }
  ctx.save(); ctx.translate(x + dw, y); ctx.scale(-1, 1);
  ctx.drawImage(im, sx, sy, size, size, 0, 0, dw, dh);
  ctx.restore();
}

const FILL = ['', '#b86f50', '#a0522d', '#f4b41b', '#c68a4f', '#8b5a3c'];

function draw(ctx: CanvasRenderingContext2D, s: S, w: number, h: number, t: number) {
  const a = getArt();
  if (!a && typeof window !== 'undefined') waiting.set(ctx, () => draw(ctx, s, w, h, 1));
  ctx.imageSmoothingEnabled = false;
  const L = level(s.rng, s.lv), ts = h / H, view = w / ts;
  const fi = Math.min(FRAMES, t * FRAMES), k = Math.min(FRAMES - 1, Math.floor(fi)), fr = fi - k, p = s.poses;
  const jump = Math.abs(p[2 * k + 2] - p[2 * k]) > 1 || Math.abs(p[2 * k + 3] - p[2 * k + 1]) > 1;
  const px = jump ? p[2 * k + 2] : p[2 * k] + (p[2 * k + 2] - p[2 * k]) * fr;
  const py = jump ? p[2 * k + 3] : p[2 * k + 1] + (p[2 * k + 3] - p[2 * k + 1]) * fr;
  const cam = Math.max(0, Math.min(W - view, px + PW / 2 - view * 0.4));
  const X = (c: number) => Math.round((c - cam) * ts), Y = (r: number) => Math.round(r * ts);
  const f = s.f - FRAMES + fi;

  ctx.fillStyle = '#dff6f5'; ctx.fillRect(0, 0, w, h);
  if (a) {
    const bw = 96 * (h / 72), off = -((cam * ts * 0.35) % bw);
    for (let x = off; x < w; x += bw) ctx.drawImage(a.bg, 0, 0, 96, 72, Math.floor(x), 0, Math.ceil(bw) + 1, h);
  }
  const c0 = Math.max(0, Math.floor(cam)), c1 = Math.min(W - 1, Math.ceil(cam + view));
  for (let c = c0; c <= c1; c++) for (let r = 0; r < H; r++) {
    const kind = tile(L, c, r);
    if (!kind) continue;
    const x = X(c), y = Y(r), dw = X(c + 1) - x, dh = Y(r + 1) - y;
    if (!a) {
      ctx.fillStyle = kind === BONUS && s.bumped.includes(L.bonus.indexOf(r * W + c)) ? '#8a6a4a' : FILL[kind];
      ctx.fillRect(x, y, dw, dh);
      if (kind === GROUND && r === GY) { ctx.fillStyle = '#3fa55a'; ctx.fillRect(x, y, dw, dh * 0.25); }
      continue;
    }
    let idx = 6;
    const l = tile(L, c - 1, r) === kind, rt = tile(L, c + 1, r) === kind;
    if (kind === GROUND) idx = (r === GY ? 0 : 120) + (l && rt ? 2 : l ? 3 : rt ? 1 : 0);
    else if (kind === BONUS) idx = s.bumped.includes(L.bonus.indexOf(r * W + c)) ? 31 : 11;
    else if (kind === PLANK) idx = l && rt ? 49 : l ? 50 : 48;
    else if (kind === CRATE) idx = 26;
    sprite(ctx, a.tiles, 18, 20, idx, x, y, dw, dh);
  }
  // goal flag
  for (let r = 5; r < GY; r++) {
    if (a) sprite(ctx, a.tiles, 18, 20, r === 5 ? 111 : 131, X(L.flag), Y(r), X(L.flag + 1) - X(L.flag), Y(r + 1) - Y(r));
    else { ctx.fillStyle = '#9ca3af'; ctx.fillRect(X(L.flag) + ts * 0.4, Y(r), ts * 0.15, ts); if (r === 5) { ctx.fillStyle = '#ef4444'; ctx.fillRect(X(L.flag) + ts * 0.55, Y(r), ts * 0.45, ts * 0.4); } }
  }
  const bob = Math.sin(f / 8) * ts * 0.06;
  L.coins.forEach(([cx, cy], i) => {
    if (s.got.includes(i) || cx < c0 - 1 || cx > c1 + 1) return;
    if (a) sprite(ctx, a.tiles, 18, 20, 151, X(cx), Y(cy) + bob, ts, ts);
    else { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(X(cx) + ts / 2, Y(cy) + ts / 2 + bob, ts * 0.25, 0, Math.PI * 2); ctx.fill(); }
  });
  L.enemies.forEach((_, i) => {
    if (s.dead.includes(i)) return;
    const e = ex(L, i, f), step = Math.floor(f / 8) % 2, sz = ts * 1.05;
    if (e < cam - 2 || e > cam + view + 1) return;
    const x = X(e + EW / 2) - sz / 2, y = Y(GY) - sz;
    if (a) sprite(ctx, a.chars, 24, 9, 18 + step, x, y, sz, sz, ex(L, i, f + 1) > e);
    else { ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.roundRect(x + sz * 0.1, y + sz * 0.3, sz * 0.8, sz * 0.7, sz * 0.2); ctx.fill(); }
  });
  // player
  if (!(s.inv && Math.floor(f / 4) % 2)) {
    const moving = Math.abs(p[2 * k + 2] - p[2 * k]) > 0.01, sz = ts * 1.2;
    const x = X(px + PW / 2) - sz / 2, y = Y(py + PH) - sz;
    if (a) sprite(ctx, a.chars, 24, 9, moving && Math.floor(f / 6) % 2 ? 1 : 0, x, y, sz, sz, s.face > 0);
    else {
      ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.roundRect(x + sz * 0.15, y + sz * 0.15, sz * 0.7, sz * 0.85, sz * 0.25); ctx.fill();
      ctx.fillStyle = '#e0f2fe'; ctx.fillRect(x + sz * (s.face > 0 ? 0.45 : 0.25), y + sz * 0.35, sz * 0.3, sz * 0.15);
    }
  }
  // HUD
  const fs = Math.max(10, ts * 0.6), hs = fs * 1.2;
  ctx.font = `bold ${fs}px ui-monospace, monospace`; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, fs / 5); ctx.strokeStyle = '#1f2937'; ctx.fillStyle = '#fff';
  const text = (str: string, x: number, align: CanvasTextAlign) => { ctx.textAlign = align; ctx.strokeText(str, x, hs * 0.8); ctx.fillText(str, x, hs * 0.8); };
  for (let i = 0; i < 3; i++) {
    const x = hs * 0.3 + i * hs, y = hs * 0.2;
    if (a) sprite(ctx, a.tiles, 18, 20, i < s.lives ? 44 : 46, x, y, hs, hs);
    else { ctx.fillStyle = i < s.lives ? '#ef4444' : '#4b5563'; ctx.fillRect(x + hs * 0.15, y + hs * 0.15, hs * 0.7, hs * 0.7); ctx.fillStyle = '#fff'; }
  }
  if (a) sprite(ctx, a.tiles, 18, 20, 151, hs * 3.6, hs * 0.2, hs, hs);
  text(`${s.coins}`, hs * 4.7, 'left');
  text(`LV ${s.lv}  ${jevbros.score(s)}`, w - hs * 0.4, 'right');
  if (done(s)) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, h);
    ctx.font = `bold ${fs * 2}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.fillText(s.lives <= 0 ? 'GAME OVER' : 'TIME UP', w / 2, h / 2);
  }
}
