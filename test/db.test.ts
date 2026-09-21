import { expect, it } from 'vitest';
import { isLive } from '../src/lib/db';

it('treats a session idle for over 3 minutes as ended, also when used as a find callback', () => {
  const old = { status: 'live' as const, last_at: new Date(Date.now() - 4 * 60_000).toISOString() };
  const fresh = { status: 'live' as const, last_at: new Date().toISOString() };
  expect([old].find(isLive)).toBeUndefined();
  expect([old, fresh].find(isLive)).toBe(fresh);
  expect(isLive({ ...fresh, status: 'ended' })).toBe(false);
});
