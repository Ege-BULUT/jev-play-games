// mulberry32. The generator state lives inside each game state, so step() stays pure and a
// snapshot plus an action always reproduces the same next state.
export function next(seed: number): [value: number, seed: number] {
  const s = (seed + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export const isInt = (v: unknown): v is number => Number.isInteger(v);

export const isIntGrid = (v: unknown, rows: number, cols: number, max: number): v is number[][] =>
  Array.isArray(v) && v.length === rows &&
  v.every((r) => Array.isArray(r) && r.length === cols && r.every((c) => isInt(c) && c >= 0 && c <= max));
