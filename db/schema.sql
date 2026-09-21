-- Applied by scripts/migrate.mjs. Idempotent: safe to run again.

create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  game        text not null,
  seed        integer not null,
  status      text not null default 'live' check (status in ('live', 'ended')),
  leader      text,
  leader_seen timestamptz,
  last_seq    integer not null default 0,
  claimed_seq integer not null default 0,
  last_at     timestamptz not null default now(),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  score       integer not null default 0
);
-- At most one live session per game: that is also the concurrency cap on Jev spend.
create unique index if not exists sessions_one_live on sessions (game) where status = 'live';
create index if not exists sessions_game_started on sessions (game, started_at desc);

alter table sessions add column if not exists claimed_seq integer not null default 0;

create table if not exists decisions (
  session_id uuid not null references sessions (id) on delete cascade,
  seq        integer not null,
  state      jsonb not null,      -- snapshot the action was chosen from; replays apply action to it
  action     text not null,
  probs      jsonb not null,      -- option -> probability, as Jev returned it
  labels     jsonb not null,      -- option -> short label shown on the bar
  confidence real,
  latency_ms integer not null,
  tokens     integer not null,
  at         timestamptz not null default now(),
  primary key (session_id, seq)
);

create table if not exists spend (
  day          date primary key,
  input_tokens bigint not null default 0
);

alter table sessions  enable row level security;
alter table decisions enable row level security;
alter table spend     enable row level security;

drop policy if exists "public read" on sessions;
create policy "public read" on sessions for select using (true);
drop policy if exists "public read" on decisions;
create policy "public read" on decisions for select using (true);
-- spend: no policy, only the service role reads or writes it.

-- Viewers follow a live game through postgres_changes on these two tables.
do $$ begin
  alter publication supabase_realtime add table decisions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table sessions;
exception when duplicate_object then null; end $$;

-- Ends every live session nobody has driven for 3 minutes. Called before any session lookup,
-- so the rule needs no cron: a game with no viewers has no leader, makes no Jev calls, and is
-- closed the next time anyone asks.
create or replace function end_idle_sessions() returns void language sql as $$
  update sessions set status = 'ended', ended_at = last_at
  where status = 'live' and last_at < now() - interval '3 minutes';
$$;

-- Grants turn p_seq to p_leader. Each turn is claimed once, so parallel requests cannot buy
-- several Jev calls for one turn; the claim can only be re-taken once its holder has been silent
-- for 6 seconds. A session idle for 3 minutes is over and cannot be revived. Atomic: the
-- conditional UPDATE is the lock.
create or replace function claim_turn(p_session uuid, p_leader text, p_seq integer, p_min_gap_ms integer)
returns boolean language sql as $$
  with c as (
    update sessions set leader = p_leader, leader_seen = now(), claimed_seq = p_seq
    where id = p_session and status = 'live' and last_seq = p_seq - 1
      and (claimed_seq < p_seq or leader_seen < now() - interval '6 seconds')
      and (p_seq = 1 or last_at > now() - interval '3 minutes')
      and (p_seq = 1 or last_at < now() - make_interval(secs => p_min_gap_ms / 1000.0))
    returning 1
  ) select exists (select 1 from c);
$$;

-- A stored decision advances its session in the same statement, so the two cannot disagree.
create or replace function advance_session() returns trigger language plpgsql as $$
begin
  update sessions set last_seq = new.seq, last_at = now() where id = new.session_id and last_seq < new.seq;
  return new;
end $$;
drop trigger if exists decisions_advance on decisions;
create trigger decisions_advance after insert on decisions for each row execute function advance_session();

create or replace function add_spend(p_tokens integer) returns bigint language sql as $$
  insert into spend (day, input_tokens) values ((now() at time zone 'utc')::date, p_tokens)
  on conflict (day) do update set input_tokens = spend.input_tokens + excluded.input_tokens
  returning input_tokens;
$$;

-- Every Jev call in the last two minutes. The gateway allows 30 requests a minute for the whole
-- project and answers the 31st with a 429 and a retry-after of up to 60 s, so begin_turn keeps
-- the site under that itself.
create table if not exists jev_calls (id bigserial primary key, at timestamptz not null default now());
create index if not exists jev_calls_at on jev_calls (at);
alter table jev_calls enable row level security;

-- Gives a claimed turn back, when the Jev call behind it could not be made.
create or replace function release_turn(p_session uuid, p_seq integer) returns void language sql as $$
  update sessions set claimed_seq = p_seq - 1
  where id = p_session and claimed_seq = p_seq and last_seq = p_seq - 1;
$$;

drop function if exists begin_turn(uuid, text, integer, integer, bigint);
-- One round trip to start a turn: budget check, claim, and what the server needs to rebuild the
-- state. Returns {error[, retry_ms]} or {game, seed, prev: {state, action} | null}.
create or replace function begin_turn(p_session uuid, p_leader text, p_seq integer, p_min_gap_ms integer, p_cap_tokens bigint, p_rpm integer)
returns jsonb language plpgsql as $$
declare
  s sessions;
  p decisions;
  calls integer;
  oldest timestamptz;
  newest timestamptz;
begin
  if coalesce((select input_tokens from spend where day = (now() at time zone 'utc')::date), 0) >= p_cap_tokens then
    return jsonb_build_object('error', 'budget');
  end if;
  if not claim_turn(p_session, p_leader, p_seq, p_min_gap_ms) then
    return jsonb_build_object('error', 'not your turn');
  end if;
  perform pg_advisory_xact_lock(7331); -- one rate check at a time across the site
  delete from jev_calls where at < now() - interval '2 minutes';
  select count(*), min(at), max(at) into calls, oldest, newest from jev_calls where at > now() - interval '60 seconds';
  -- Spread the calls evenly (one per 60/p_rpm s) so games move at a steady pace instead of
  -- bursting through the minute's budget and then stalling; the window count is the backstop.
  if newest is not null and now() - newest < make_interval(secs => 60.0 / p_rpm) then
    perform release_turn(p_session, p_seq);
    return jsonb_build_object('error', 'pace',
      'retry_ms', greatest(50, ceil(extract(epoch from (newest + make_interval(secs => 60.0 / p_rpm) - now())) * 1000)));
  end if;
  if calls >= p_rpm then
    perform release_turn(p_session, p_seq);
    return jsonb_build_object('error', 'rate',
      'retry_ms', greatest(250, ceil(extract(epoch from (oldest + interval '60 seconds' - now())) * 1000)));
  end if;
  insert into jev_calls default values;
  select * into s from sessions where id = p_session;
  if p_seq > 1 then
    select * into p from decisions where session_id = p_session and seq = p_seq - 1;
    if not found then return jsonb_build_object('error', 'missing turn'); end if;
  end if;
  return jsonb_build_object('game', s.game, 'seed', s.seed,
    'prev', case when p_seq > 1 then jsonb_build_object('state', p.state, 'action', p.action) end);
end $$;

-- One round trip to finish it: count the spend (even if the insert loses), store the decision
-- (the trigger advances the session) and set the display score. False if the turn was taken.
create or replace function finish_turn(p_decision jsonb, p_score integer)
returns boolean language plpgsql as $$
declare
  n integer;
begin
  if (p_decision->>'tokens')::integer > 0 then perform add_spend((p_decision->>'tokens')::integer); end if;
  insert into decisions (session_id, seq, state, action, probs, labels, confidence, latency_ms, tokens)
  select session_id, seq, state, action, probs, labels, confidence, latency_ms, tokens
  from jsonb_populate_record(null::decisions, p_decision)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  update sessions set score = p_score where id = (p_decision->>'session_id')::uuid;
  return true;
end $$;

-- New functions are executable by PUBLIC, which anon inherits, so revoke from PUBLIC as well.
revoke execute on function claim_turn(uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function add_spend(integer) from public, anon, authenticated;
revoke execute on function end_idle_sessions() from public, anon, authenticated;
revoke execute on function advance_session() from public, anon, authenticated;
revoke execute on function begin_turn(uuid, text, integer, integer, bigint, integer) from public, anon, authenticated;
revoke execute on function release_turn(uuid, integer) from public, anon, authenticated;
revoke execute on function finish_turn(jsonb, integer) from public, anon, authenticated;
