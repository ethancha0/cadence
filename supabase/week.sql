-- Cadence · week planner. Run in the Supabase SQL editor after schema.sql. Safe to re-run.
--
--   categories.weekly_goal_minutes — the week budget shown on the Week page (null = no goal)
--   day_settings                   — one row per user: day bounds, timezone, iCal feeds
--   planned_sessions               — timeblocks on the Week page; a session started from one links back via session_id
--
-- planned_sessions already carries the columns the Discord reminders (docs/day-rail.md) need, so that work
-- only adds columns to day_settings.

alter table categories add column if not exists weekly_goal_minutes int check (weekly_goal_minutes >= 0);

create table if not exists day_settings (
  user_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  timezone    text not null default 'UTC',            -- IANA, written from the browser on save
  day_start   time not null default '09:00',
  wind_down   time not null default '23:00',
  calendars   jsonb not null default '[]'::jsonb,     -- [{ id, name, url, color }]; url = Google's secret iCal address
  updated_at  timestamptz not null default now()
);

create table if not exists planned_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  category_id    uuid references categories on delete cascade,  -- set for a week timeblock
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,                          -- the hard stop
  label          text not null default '',
  until_label    text not null default '',
  plan           jsonb not null default '[]'::jsonb,            -- [{ task_id, task_title, category_id, minutes, suggested }]; empty = pick at start
  status         text not null default 'planned'
                 check (status in ('planned', 'started', 'caught_up', 'skipped', 'missed')),
  session_id     uuid references sessions on delete set null,
  skip_reason    text,
  remind         boolean not null default true,
  before_sent_at timestamptz,
  start_sent_at  timestamptz,
  nudge_sent_at  timestamptz,
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
-- A database that already ran docs/day-rail.sql has planned_sessions without category_id, and the create above skips it.
alter table planned_sessions add column if not exists category_id uuid references categories on delete cascade;
create index if not exists planned_sessions_due on planned_sessions (status, starts_at);
create index if not exists planned_sessions_user on planned_sessions (user_id, starts_at);

do $$
declare t text;
begin
  foreach t in array array['day_settings', 'planned_sessions'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'owner all') then
      execute format('create policy "owner all" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

-- Live updates across windows (the overlay, another tab), like the tables in schema.sql.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'planned_sessions') then
    alter publication supabase_realtime add table public.planned_sessions;
  end if;
end $$;
