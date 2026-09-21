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

-- One round trip to start a turn: budget check, claim, and what the server needs to rebuild the
-- state. Returns {error} or {game, seed, prev: {state, action} | null}.
create or replace function begin_turn(p_session uuid, p_leader text, p_seq integer, p_min_gap_ms integer, p_cap_tokens bigint)
returns jsonb language plpgsql as $$
declare
  s sessions;
  p decisions;
begin
  if coalesce((select input_tokens from spend where day = (now() at time zone 'utc')::date), 0) >= p_cap_tokens then
    return jsonb_build_object('error', 'budget');
  end if;
  if not claim_turn(p_session, p_leader, p_seq, p_min_gap_ms) then
    return jsonb_build_object('error', 'not your turn');
  end if;
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
revoke execute on function begin_turn(uuid, text, integer, integer, bigint) from public, anon, authenticated;
revoke execute on function finish_turn(jsonb, integer) from public, anon, authenticated;
