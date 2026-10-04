-- Cadence · Supabase schema (Postgres). Run in the Supabase SQL editor.
-- Every table is owned by auth.uid(); RLS limits each user to their own rows.
-- The MCP connector runs as the signed-in user, so these same policies govern Claude.
--
-- Differences from the design handoff's schema.sql:
--   session_blocks.resumed_at  — wall-clock timer: when the current running stretch began (null = paused)
--   session_blocks.quick_notes — quick-note drafts, so a reload mid-block doesn't lose them
--   session_blocks.task_title, notes.task_title — snapshot of the task title, kept if the task is deleted

create type priority as enum ('high', 'medium', 'low');

create table categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  position    int  not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  category_id  uuid not null references categories on delete cascade,
  title        text not null,
  priority     priority not null default 'medium',
  due_date     date,                      -- null = no due date
  done_at      timestamptz,               -- null = open
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on tasks (user_id, done_at, due_date);

create table sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  planned_minutes int  not null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  pro             text,                   -- whole-session reflection
  delta           text
);

create table session_blocks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  session_id       uuid not null references sessions on delete cascade,
  task_id          uuid references tasks on delete set null,
  task_title       text not null default '',
  category_id      uuid not null references categories on delete cascade,
  position         int  not null,
  planned_minutes  int  not null,
  suggested_minutes int not null,         -- what the algorithm proposed, before manual edits
  spent_seconds    int  not null default 0, -- accumulated before resumed_at
  started_at       timestamptz,
  resumed_at       timestamptz,           -- null while paused or not running
  ended_at         timestamptz,
  quick_notes      jsonb not null default '[]'::jsonb  -- [{kind: 'pro'|'delta', text}]
);
create index on session_blocks (user_id, session_id, position);

-- Pro/delta notes are filed by CATEGORY (so they resurface for any task in it);
-- task_id/block_id record where they came from.
create table notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  category_id  uuid not null references categories on delete cascade,
  task_id      uuid references tasks on delete set null,
  task_title   text not null default '',
  block_id     uuid references session_blocks on delete set null,
  pro          text,
  delta        text,
  pinned       boolean not null default false,
  source       text not null default 'block_end',  -- 'block_end' | 'quick' | 'manual' | 'claude'
  created_at   timestamptz not null default now(),
  check (coalesce(pro, '') <> '' or coalesce(delta, '') <> '')
);
create index on notes (user_id, category_id, created_at desc);

-- RLS: owner-only on every table
do $$
declare t text;
begin
  foreach t in array array['categories','tasks','sessions','session_blocks','notes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "owner all" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Convenience view: per-category stats (used by the Claude connector; the web app computes the same numbers client-side)
create view category_stats with (security_invoker = true) as
select c.id as category_id, c.user_id, c.name,
  (select max(b.ended_at) from session_blocks b where b.category_id = c.id) as last_touched_at,
  coalesce((select sum(b.spent_seconds) from session_blocks b
            where b.category_id = c.id and b.started_at >= date_trunc('week', now())), 0) / 60 as minutes_this_week
from categories c;
