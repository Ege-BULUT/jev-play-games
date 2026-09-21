import type { Game, Option } from './types';
import { isInt } from './rng';

// A small rigid-body car on a seeded hill profile. One decision holds gas, brake or nothing for
// FRAMES physics frames; the frames' poses ride along in the state so the viewer can animate them.
const DT = 1 / 60, FRAMES = 15, G = 9.8;
const WHEEL_R = 0.42, AXLE = 1.15, WHEEL_Y = -0.45, HEAD: [number, number] = [-0.15, 0.95];
const MASS = 1, INERTIA = 1.4, K = 520, C = 34, DRIVE = 7, VMAX = 14, AIR_TORQUE = 2.4, REACTION = 3.2, TANK_S = 45, CAN_EVERY = 180;

type Pose = [x: number, y: number, a: number];
type S = {
  seed: number; x: number; y: number; a: number; vx: number; vy: number; va: number;
  fuel: number; best: number; cans: number; t: number; crashed: boolean; poses: Pose[];
};
type Act = 'gas' | 'brake' | 'coast';

// Terrain: a sum of sines whose amplitudes grow with distance, so the ride gets harder.
function ground(seed: number, x: number) {
  const p = (k: number) => ((seed * (k + 1) * 2654435761) % 1000) / 159.15;
  const ramp = Math.min(1, Math.max(0, x) / 800);
  return (3 + 3 * ramp) * Math.sin(x * 0.05 + p(1)) + (1.4 + 2.2 * ramp) * Math.sin(x * 0.13 + p(2)) +
    (0.5 + 1.2 * ramp) * Math.sin(x * 0.29 + p(3)) + 0.25 * Math.sin(x * 0.71 + p(4));
}
const slope = (seed: number, x: number) => (ground(seed, x + 0.01) - ground(seed, x - 0.01)) / 0.02;

const rot = (a: number, [lx, ly]: [number, number]): [number, number] =>
  [lx * Math.cos(a) - ly * Math.sin(a), lx * Math.sin(a) + ly * Math.cos(a)];

function frame(s: S, act: Act): S {
  let { x, y, a, vx, vy, va, fuel } = s;
  const drive = fuel > 0 ? (act === 'gas' ? DRIVE : act === 'brake' ? -DRIVE * 0.7 : 0) : 0;
  let fx = 0, fy = -G * MASS, torque = 0, grounded = false;
  for (const lx of [-AXLE, AXLE]) {
    const [ox, oy] = rot(a, [lx, WHEEL_Y]);
    const wx = x + ox, wy = y + oy;
    const h = ground(s.seed, wx), pen = h + WHEEL_R - wy;
    if (pen <= 0) continue;
    grounded = true;
    const m = slope(s.seed, wx), len = Math.hypot(1, m);
    const nx = -m / len, ny = 1 / len, tx = 1 / len, ty = m / len;
    const pvx = vx - va * oy, pvy = vy + va * ox; // velocity of the contact point
    const vn = pvx * nx + pvy * ny, vt = pvx * tx + pvy * ty;
    const fn = Math.max(0, K * pen - C * vn);
    const ft = (drive / 2) * Math.max(0, 1 - (Math.sign(drive) * vt) / VMAX) - 0.12 * vt; // traction fades toward top speed, plus rolling drag
    const px = nx * fn + tx * ft, py = ny * fn + ty * ft;
    fx += px; fy += py; torque += ox * py - oy * px;
  }
  // Gas tips the nose up and brake tips it down: in the air by steering the body, on the ground as
  // the reaction to the wheel torque. That is what makes a steep climb flip the car.
  const tip = act === 'gas' ? 1 : act === 'brake' ? -1 : 0;
  torque += tip * (grounded ? (fuel > 0 ? REACTION : 0) : AIR_TORQUE);
  vx += (fx / MASS) * DT; vy += (fy / MASS) * DT; va += (torque / INERTIA) * DT;
  va *= 0.99;
  x += vx * DT; y += vy * DT; a += va * DT;
  if (act !== 'coast' || vx * vx + vy * vy > 0.01) fuel = Math.max(0, fuel - DT / TANK_S);
  let cans = s.cans;
  if (x >= (cans + 1) * CAN_EVERY) { cans++; fuel = 1; }
  const [hx, hy] = rot(a, HEAD);
  const crashed = y + hy < ground(s.seed, x + hx) + 0.1;
  return { ...s, x, y, a, vx, vy, va, fuel, cans, best: Math.max(s.best, x), t: s.t + 1, crashed };
}

function run(s: S, act: Act, frames: number) {
  const poses: Pose[] = [];
  for (let i = 0; i < frames && !s.crashed; i++) { s = frame(s, act); poses.push([s.x, s.y, s.a]); }
  return { ...s, poses };
}

const deg = (a: number) => Math.round((a * 180) / Math.PI);
const LOOKAHEAD = 60;

export const hillclimb: Game<S> = {
  id: 'hillclimb',
  title: 'Hill Climb',
  blurb: 'Gas, brake, balance, fuel.',
  accent: '#f97316',
  instruction: 'Which input drives the car furthest over the hills without flipping over or running out of fuel?',
  stepMs: (FRAMES * 1000) / 60,
  realtime: true,
  init(seed) {
    const s0 = seed | 0;
    const base: S = { seed: s0, x: 2, y: ground(s0, 2) + 1.2, a: Math.atan(slope(s0, 2)), vx: 0, vy: 0, va: 0, fuel: 1, best: 2, cans: 0, t: 0, crashed: false, poses: [] };
    return run(base, 'coast', 30); // let the suspension settle
  },
  isState(v): v is S {
    const s = v as S;
    return !!s && ['x', 'y', 'a', 'vx', 'vy', 'va', 'fuel', 'best'].every((k) => Number.isFinite(s[k as keyof S])) &&
      isInt(s.seed) && isInt(s.cans) && isInt(s.t) && typeof s.crashed === 'boolean' && Array.isArray(s.poses);
  },
  describe(s) {
    const ahead = [5, 10, 20].map((d) => `${d} m ahead the ground is ${(ground(s.seed, s.x + d) - ground(s.seed, s.x)).toFixed(1)} m ${ground(s.seed, s.x + d) >= ground(s.seed, s.x) ? 'higher' : 'lower'}`);
    return `Hill-climb car at ${s.x.toFixed(1)} m. Speed ${s.vx.toFixed(1)} m/s forward, ${s.vy.toFixed(1)} m/s up. ` +
      `Pitch ${deg(s.a)}° (positive is nose up; past about 100° the car flips). Spin ${deg(s.va)}°/s. ` +
      `Fuel ${Math.round(s.fuel * 100)}%, next fuel can at ${(s.cans + 1) * CAN_EVERY} m. ${ahead.join('; ')}.`;
  },
  options(s) {
    return (['gas', 'coast', 'brake'] as Act[]).map((act): Option => {
      const r = run({ ...s, poses: [] }, act, LOOKAHEAD);
      const verdict = r.crashed ? 'the driver crashes, game over' : `pitch ends at ${deg(r.a)}°, speed ${r.vx.toFixed(1)} m/s`;
      return {
        id: act,
        label: { gas: '⏵ Gas', coast: '⏸ Coast', brake: '⏴ Brake' }[act],
        detail: `Hold ${act} for one second: moves ${(r.x - s.x).toFixed(1)} m, ${verdict}, fuel ${Math.round(r.fuel * 100)}%.`,
      };
    });
  },
  step: (s, action) => run(s, (['gas', 'brake', 'coast'].includes(action) ? action : 'coast') as Act, FRAMES),
  over: (s) => s.crashed || s.t > 60 * 60 * 15 || (s.fuel <= 0 && Math.abs(s.vx) < 0.05),
  score: (s) => Math.floor(s.best),
  render(ctx, s, w, h, t) {
    const pose = s.poses.length ? s.poses[Math.min(s.poses.length - 1, Math.floor(t * s.poses.length))] : [s.x, s.y, s.a];
    const [cx, cy, ca] = pose;
    const scale = Math.min(w, h) / 16, ox = w * 0.35, oy = h * 0.58;
    const X = (x: number) => ox + (x - cx) * scale, Y = (y: number) => oy - (y - cy) * scale;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1e3a8a'); sky.addColorStop(1, '#f59e0b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ctx.beginPath(); ctx.moveTo(0, h); // far hills, scrolling at a fifth of the speed
    for (let px = 0; px <= w; px += 8) ctx.lineTo(px, h * 0.5 - Math.sin((px + cx * scale * 0.2) * 0.008) * h * 0.08 - Math.sin((px + cx * scale * 0.2) * 0.021) * h * 0.04);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = '#1e293b99'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let px = 0; px <= w; px += 4) ctx.lineTo(px, Y(ground(s.seed, cx + (px - ox) / scale)));
    ctx.lineTo(w, h); ctx.closePath();
    ctx.fillStyle = '#3f6212'; ctx.fill();
    ctx.strokeStyle = '#a3e635'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#fef3c7'; ctx.font = `600 ${Math.max(10, scale * 0.45)}px ui-sans-serif, system-ui`; ctx.textAlign = 'center';
    for (let m = Math.ceil((cx - 20) / 50) * 50; m < cx + 25; m += 50) { // distance posts
      if (m <= 0) continue;
      const gy = Y(ground(s.seed, m));
      ctx.fillRect(X(m) - 1.5, gy - scale * 1.4, 3, scale * 1.4);
      ctx.fillText(`${m} m`, X(m), gy - scale * 1.6);
    }
    ctx.textAlign = 'left';
    const can = (s.cans + 1) * CAN_EVERY;
    if (Math.abs(can - cx) < 30) { ctx.fillStyle = '#ef4444'; ctx.fillRect(X(can) - 8, Y(ground(s.seed, can)) - 26, 16, 22); }
    ctx.save(); ctx.translate(X(cx), Y(cy)); ctx.rotate(-ca);
    ctx.fillStyle = s.crashed ? '#7f1d1d' : '#dc2626';
    ctx.beginPath(); ctx.roundRect(-1.5 * scale, -0.55 * scale, 3 * scale, 0.7 * scale, 0.2 * scale); ctx.fill();
    ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(HEAD[0] * scale, -HEAD[1] * scale, 0.3 * scale, 0, Math.PI * 2); ctx.fill();
    for (const lx of [-AXLE, AXLE]) {
      ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(lx * scale, -WHEEL_Y * scale, WHEEL_R * scale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9ca3af'; ctx.beginPath(); ctx.arc(lx * scale, -WHEEL_Y * scale, WHEEL_R * scale * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#0008'; ctx.fillRect(12, 12, 170, 44);
    ctx.fillStyle = '#fff'; ctx.font = '600 14px ui-sans-serif, system-ui';
    ctx.fillText(`${Math.floor(s.best)} m`, 22, 30);
    ctx.fillStyle = '#374151'; ctx.fillRect(22, 38, 150, 8);
    ctx.fillStyle = s.fuel > 0.25 ? '#22c55e' : '#ef4444'; ctx.fillRect(22, 38, 150 * s.fuel, 8);
  },
};
