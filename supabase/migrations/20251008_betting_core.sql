-- Matches what you ran in bet-dev
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where t.typname='sport_t' and n.nspname='public') then
    create type public.sport_t as enum ('nfl','nba','nhl','ncaaf','mlb','ncaab','mma','soccer');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where t.typname='market_t' and n.nspname='public') then
    create type public.market_t as enum ('moneyline','spread','total');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where t.typname='side_t' and n.nspname='public') then
    create type public.side_t as enum ('home','away','draw','over','under');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where t.typname='slip_status_t' and n.nspname='public') then
    create type public.slip_status_t as enum ('open','settled','won','lost','void');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where t.typname='leg_result_t' and n.nspname='public') then
    create type public.leg_result_t as enum ('pending','won','lost','void','push');
  end if;
end$$;

alter table if exists public.profiles
  add column if not exists role text
  check (role in ('user','admin','superadmin'))
  default 'user';

create table if not exists public.sports_events (
  id uuid primary key default gen_random_uuid(),
  sport sport_t not null,
  external_event_id text unique,
  league text,
  starts_at timestamptz not null,
  status text default 'scheduled',
  home_team text not null,
  away_team text not null,
  home_score int default 0,
  away_score int default 0,
  created_at timestamptz default now()
);
create index if not exists ix_events_starts_at on public.sports_events (starts_at);
create index if not exists ix_events_status   on public.sports_events (status);

create table if not exists public.event_odds_snapshots (
  id bigserial primary key,
  event_id uuid not null references public.sports_events(id) on delete cascade,
  captured_at timestamptz not null default now(),
  bookmaker text not null,
  market market_t not null,
  side side_t not null,
  line numeric(6,2),
  american_odds int not null,
  unique(event_id, bookmaker, market, side, line, captured_at)
);
create index if not exists ix_snap_event_captured on public.event_odds_snapshots (event_id, captured_at desc);
create index if not exists ix_snap_event_only     on public.event_odds_snapshots (event_id);

create table if not exists public.bet_slips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  stake numeric(12,2) not null check (stake > 0),
  status slip_status_t not null default 'open',
  created_at timestamptz default now(),
  settled_at timestamptz
);
create index if not exists ix_slips_user_created on public.bet_slips (user_id, created_at desc);

create table if not exists public.bet_legs (
  id bigserial primary key,
  slip_id uuid not null references public.bet_slips(id) on delete cascade,
  event_id uuid not null references public.sports_events(id),
  market market_t not null,
  side side_t not null,
  line numeric(6,2),
  american_odds int not null,
  bookmaker text,
  priced_at timestamptz not null default now(),
  result leg_result_t not null default 'pending'
);
create index if not exists ix_legs_slip  on public.bet_legs (slip_id);
create index if not exists ix_legs_event on public.bet_legs (event_id);

create or replace function public.american_to_decimal(odds int)
returns numeric language sql immutable as $$
  select case when odds > 0 then 1 + (odds/100.0) else 1 + (100.0/abs(odds)) end;
$$;

create or replace function public.execute_place_bet(
  p_user_id uuid,
  p_stake numeric,
  p_event_id uuid,
  p_market market_t,
  p_side side_t,
  p_line numeric,
  p_american_odds int
) returns void language plpgsql as $$
declare _slip uuid;
begin
  perform 1 from public.wallets w where w.user_id = p_user_id for update;
  update public.wallets set balance = balance - p_stake
   where user_id = p_user_id and balance >= p_stake;
  if not found then raise exception 'insufficient funds'; end if;

  insert into public.bet_slips(user_id, stake) values (p_user_id, p_stake)
  returning id into _slip;

  insert into public.bet_legs(slip_id, event_id, market, side, line, american_odds)
  values (_slip, p_event_id, p_market, p_side, p_line, p_american_odds);
end;
$$;

create or replace view public.v_user_bets as
select
  s.id as slip_id,
  s.user_id,
  s.stake,
  s.status,
  s.created_at,
  json_agg(json_build_object(
    'leg_id', l.id, 'event_id', l.event_id, 'market', l.market, 'side', l.side,
    'line', l.line, 'american_odds', l.american_odds, 'result', l.result
  ) order by l.id) as legs,
  round(
    s.stake * coalesce(
      (select exp(sum(ln(public.american_to_decimal(l2.american_odds)::numeric)))
       from public.bet_legs l2 where l2.slip_id = s.id), 1
    )::numeric, 2
  ) as potential_payout
from public.bet_slips s
join public.bet_legs l on l.slip_id = s.id
group by s.id;

drop materialized view if exists public.mv_leaderboard;
create materialized view public.mv_leaderboard as
select
  s.user_id,
  count(*) filter (where s.status in ('won','lost','void','settled')) as bets,
  count(*) filter (where s.status = 'won') as wins,
  count(*) filter (where s.status = 'lost') as losses,
  sum(s.stake) as total_staked,
  sum(case
        when s.status = 'won' then
          s.stake * ((select exp(sum(ln(public.american_to_decimal(l.american_odds)::numeric)))
                      from public.bet_legs l where l.slip_id = s.id))
        when s.status = 'lost' then 0
        else 0
      end) as total_return,
  round(
    (coalesce(sum(case
                    when s.status='won' then
                      s.stake * ((select exp(sum(ln(public.american_to_decimal(l.american_odds)::numeric)))
                                  from public.bet_legs l where l.slip_id = s.id))
                    when s.status='lost' then 0
                    else 0
                  end),0)
     - sum(s.stake)) / nullif(sum(s.stake),0) * 100.0, 2
  ) as roi_pct
from public.bet_slips s
group by s.user_id;
create index if not exists ix_mv_lb_user on public.mv_leaderboard (user_id);

alter table public.bet_slips enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='bet_slips' and policyname='own-slips'
  ) then
    create policy "own-slips" on public.bet_slips
      for select using (auth.uid() = user_id);
  end if;
end$$;

grant select on public.v_user_bets    to anon, authenticated;
grant select on public.mv_leaderboard to anon, authenticated;
