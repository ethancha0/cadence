-- Cadence · Day rail: calendars, planned sessions, and Discord reminders.
-- Run once in the Supabase SQL editor, after schema.sql. Safe to re-run.
--
-- Reminders are sent from Postgres (pg_cron + pg_net) because nothing in the browser runs
-- while Cadence is closed. If `create extension` is refused, enable pg_cron and pg_net under
-- Database → Extensions first.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One row per user. Everything the reminder job needs lives here, so it never reads auth.users.
create table if not exists day_settings (
  user_id             uuid primary key default auth.uid() references auth.users on delete cascade,
  timezone            text not null default 'UTC',          -- IANA, written from the browser
  day_start           time not null default '09:00',
  wind_down           time not null default '22:00',        -- also when the recap is sent
  buffer_minutes      int  not null default 5  check (buffer_minutes between 0 and 60),
  min_window_minutes  int  not null default 30 check (min_window_minutes between 15 and 240),
  calendars           jsonb not null default '[]'::jsonb,   -- [{ "name": "Classes", "url": "https://calendar.google.com/calendar/ical/.../basic.ics" }]
  discord_webhook_url text check (discord_webhook_url ~ '^https://(discord|discordapp)\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$'),
  discord_user_id     text check (discord_user_id ~ '^[0-9]{15,22}$'),
  app_url             text,                                 -- origin for links in messages, written from the browser
  remind_before       boolean not null default true,
  remind_start        boolean not null default true,
  remind_nudge        boolean not null default true,
  remind_recap        boolean not null default true,
  recap_sent_on       date,
  updated_at          timestamptz not null default now()
);

create table if not exists planned_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,                      -- the hard stop: next event minus buffer, or wind-down
  label          text not null default '',                  -- "Between classes", "Tonight"
  until_label    text not null default '',                  -- what ends it: "PSYCH 7A · Discussion", or "" for wind-down
  plan           jsonb not null default '[]'::jsonb,        -- [{ task_id, task_title, category_id, minutes, suggested }] in block order
  status         text not null default 'planned'
                 check (status in ('planned', 'started', 'caught_up', 'skipped', 'missed')),
  session_id     uuid references sessions on delete set null,
  skip_reason    text,
  remind         boolean not null default true,             -- the "Remind me on Discord" checkbox
  before_sent_at timestamptz,
  start_sent_at  timestamptz,
  nudge_sent_at  timestamptz,
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists planned_sessions_due on planned_sessions (status, starts_at);
create index if not exists planned_sessions_user on planned_sessions (user_id, starts_at);

-- RLS: owner-only, same as every other table.
do $$
declare t text;
begin
  foreach t in array array['day_settings','planned_sessions'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner all') then
      execute format('create policy "owner all" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

-- ---------- message helpers ----------
-- Internal: none of these are callable by app users (see the revokes at the bottom).

-- A timezone Postgres knows, else UTC, so one bad value can't fail the whole tick.
create or replace function cadence_tz(tz text) returns text
language sql stable set search_path = public as $$
  select coalesce((select name from pg_timezone_names where name = tz limit 1), 'UTC')
$$;

-- Escape Discord markdown in user text (task titles, skip reasons).
create or replace function cadence_md(s text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(coalesce(s, ''), '([\\*_~|>#`])', '\\\1', 'g')
$$;

-- "1:30 PM", or "1:30" when short.
create or replace function cadence_clock(ts timestamptz, tz text, short boolean default false) returns text
language sql stable set search_path = public as $$
  select to_char(ts at time zone cadence_tz(tz), case when short then 'FMHH12:MI' else 'FMHH12:MI AM' end)
$$;

-- "1h 25m", "45m", "3h"
create or replace function cadence_len(minutes int) returns text
language sql immutable set search_path = public as $$
  select case
    when minutes >= 60 and minutes % 60 = 0 then (minutes / 60) || 'h'
    when minutes >= 60 then (minutes / 60) || 'h ' || (minutes % 60) || 'm'
    else minutes || 'm'
  end
$$;

-- Queue a webhook post. allowed_mentions parse=[] means a task titled "@everyone" pings nobody;
-- only `mention` (the user's own ID) can be pinged. Returns pg_net's request id.
create or replace function cadence_post(hook text, content text, mention text default null) returns bigint
language sql volatile set search_path = public as $$
  select net.http_post(
    url := hook,
    body := jsonb_build_object(
      'content', left(content, 2000),
      'allowed_mentions', jsonb_build_object(
        'parse', '[]'::jsonb,
        'users', case when mention is null then '[]'::jsonb else jsonb_build_array(mention) end
      )
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
$$;

create or replace function cadence_link(s day_settings, path text) returns text
language sql stable set search_path = public as $$
  select rtrim(coalesce(s.app_url, ''), '/') || path
$$;

-- **Session at 1:30 PM** · 1h 25m, hard stop 2:55
-- 01 Fix timezone offset in availability grid · 45m
-- [Open plan](<…/session/start?planned=…>)
create or replace function cadence_msg_before(p planned_sessions, s day_settings) returns text
language sql stable set search_path = public as $$
  select '**Session at ' || cadence_clock(p.starts_at, s.timezone) || '** · '
    || cadence_len((extract(epoch from p.ends_at - p.starts_at) / 60)::int)
    || ', hard stop ' || cadence_clock(p.ends_at, s.timezone, true) || E'\n'
    || coalesce((
      select string_agg(lpad(ord::text, 2, '0') || ' ' || cadence_md(item->>'task_title') || ' · ' || cadence_len((item->>'minutes')::int), E'\n' order by ord)
      from jsonb_array_elements(p.plan) with ordinality as t(item, ord)
    ) || E'\n', '')
    || '[Open plan](<' || cadence_link(s, '/session/start?planned=' || p.id) || '>)'
$$;

-- **Starting now.** Timezone fix first. Hard stop 2:55. [Start session](<…>)
create or replace function cadence_msg_start(p planned_sessions, s day_settings) returns text
language sql stable set search_path = public as $$
  select '**Starting now.** '
    || coalesce(cadence_md(left(p.plan->0->>'task_title', 60)) || ' first. ', '')
    || 'Hard stop ' || cadence_clock(p.ends_at, s.timezone, true) || '. '
    || '[Start session](<' || cadence_link(s, '/session/start?planned=' || p.id) || '>)'
$$;

-- <@id> **Nothing's running yet.** Already working on it?
-- [Log it from 1:30](<…>) · [Start now](<…>) · [Skip and say why](<…>)
create or replace function cadence_msg_nudge(p planned_sessions, s day_settings) returns text
language sql stable set search_path = public as $$
  select coalesce('<@' || s.discord_user_id || '> ', '')
    || '**Nothing''s running yet.** Already working on it?' || E'\n'
    || '[Log it from ' || cadence_clock(p.starts_at, s.timezone, true) || '](<' || cadence_link(s, '/session/catch-up?planned=' || p.id) || '>)'
    || ' · [Start now](<' || cadence_link(s, '/session/start?planned=' || p.id) || '>)'
    || ' · [Skip and say why](<' || cadence_link(s, '/session/skip?planned=' || p.id) || '>)'
$$;

-- **Today: kept 2 of 3 sessions.** 4h 15m of 5h 25m planned.
-- 1:30 · caught up from 1:30
-- 3:55 · skipped: "Something urgent"
-- 7:00 · started on time
-- [See today](<…/day>)
create or replace function cadence_msg_recap(s day_settings) returns text
language sql stable set search_path = public as $$
  with today as (
    select p.*, se.started_at as session_started,
      (select coalesce(sum(b.spent_seconds), 0) from session_blocks b where b.session_id = p.session_id) as spent_seconds,
      (select coalesce(sum((i->>'minutes')::int), 0) from jsonb_array_elements(p.plan) i) as planned_minutes
    from planned_sessions p
    left join sessions se on se.id = p.session_id
    where p.user_id = s.user_id
      and (p.starts_at at time zone cadence_tz(s.timezone))::date = (now() at time zone cadence_tz(s.timezone))::date
  )
  select '**Today: kept ' || count(*) filter (where status in ('started', 'caught_up')) || ' of ' || count(*) || ' sessions.** '
    || cadence_len((sum(spent_seconds) / 60)::int) || ' of '
    || cadence_len(sum(planned_minutes)::int) || ' planned.' || E'\n'
    || string_agg(
      cadence_clock(starts_at, s.timezone, true) || ' · ' || case status
        when 'caught_up' then 'caught up' || coalesce(' from ' || cadence_clock(session_started, s.timezone, true), '')
        when 'skipped' then 'skipped' || coalesce(': "' || cadence_md(skip_reason) || '"', '')
        when 'missed' then 'missed'
        when 'started' then case
          when session_started is null or session_started <= starts_at + interval '5 minutes' then 'started on time'
          else 'started ' || round(extract(epoch from session_started - starts_at) / 60)::int || ' min late'
        end
        else 'planned'
      end, E'\n' order by starts_at) || E'\n'
    || '[See today](<' || cadence_link(s, '/day') || '>)'
  from today
$$;

-- ---------- the tick ----------

create or replace function cadence_reminder_tick() returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- 1. Link sessions started another way (e.g. from /), so the nudge doesn't fire.
  --    Each session links to one planned row (the one whose start is nearest), each row to one session.
  with candidates as (
    select distinct on (se.id) p.id as planned_id, se.id as session_id, se.started_at
    from planned_sessions p
    join sessions se on se.user_id = p.user_id
      and se.started_at between p.starts_at - interval '15 minutes' and p.ends_at
    where p.status = 'planned'
      and p.starts_at - interval '15 minutes' <= now()
      and not exists (select 1 from planned_sessions o where o.session_id = se.id)
    order by se.id, abs(extract(epoch from se.started_at - p.starts_at))
  ), pick as (
    select distinct on (planned_id) planned_id, session_id from candidates order by planned_id, started_at
  )
  update planned_sessions p set status = 'started', session_id = pick.session_id
  from pick where p.id = pick.planned_id;

  -- 2. Mark missed.
  update planned_sessions set status = 'missed' where status = 'planned' and ends_at < now();

  -- 3. Per-session messages. Each fires only inside its own window, so a cron outage never sends
  --    stale reminders; the windows don't overlap, so a row gets at most one message per tick.
  --    The *_sent_at stamp is set in the same statement that queues the post.
  with sent as (
    update planned_sessions p set before_sent_at = now()
    from day_settings s
    where s.user_id = p.user_id and s.discord_webhook_url is not null and s.remind_before
      and p.status = 'planned' and p.remind and p.before_sent_at is null
      and now() >= p.starts_at - interval '5 minutes' and now() < p.starts_at
    returning cadence_post(s.discord_webhook_url, cadence_msg_before(p, s))
  ) select count(*) into n from sent;

  with sent as (
    update planned_sessions p set start_sent_at = now()
    from day_settings s
    where s.user_id = p.user_id and s.discord_webhook_url is not null and s.remind_start
      and p.status = 'planned' and p.remind and p.start_sent_at is null
      and now() >= p.starts_at and now() < p.starts_at + interval '5 minutes'
    returning cadence_post(s.discord_webhook_url, cadence_msg_start(p, s))
  ) select count(*) into n from sent;

  with sent as (
    update planned_sessions p set nudge_sent_at = now()
    from day_settings s
    where s.user_id = p.user_id and s.discord_webhook_url is not null and s.remind_nudge
      and p.status = 'planned' and p.remind and p.nudge_sent_at is null
      and now() >= p.starts_at + interval '10 minutes' and now() < p.ends_at
    returning cadence_post(s.discord_webhook_url, cadence_msg_nudge(p, s), s.discord_user_id)
  ) select count(*) into n from sent;

  -- 4. Nightly recap at wind-down, once per local day, if anything was planned today.
  with sent as (
    update day_settings s set recap_sent_on = (now() at time zone cadence_tz(s.timezone))::date
    where s.remind_recap and s.discord_webhook_url is not null
      and (now() at time zone cadence_tz(s.timezone))::time >= s.wind_down
      and s.recap_sent_on is distinct from (now() at time zone cadence_tz(s.timezone))::date
      and exists (
        select 1 from planned_sessions p
        where p.user_id = s.user_id
          and (p.starts_at at time zone cadence_tz(s.timezone))::date = (now() at time zone cadence_tz(s.timezone))::date)
    returning cadence_post(s.discord_webhook_url, cadence_msg_recap(s))
  ) select count(*) into n from sent;
end $$;

-- Settings → "Send test message": posts to the caller's own stored webhook, nowhere else.
create or replace function cadence_send_test() returns void
language plpgsql security definer set search_path = public as $$
declare hook text;
begin
  select discord_webhook_url into hook from day_settings where user_id = auth.uid();
  if hook is null then
    raise exception 'Save a Discord webhook first.';
  end if;
  perform cadence_post(hook, 'Cadence is connected. Reminders for sessions you save on the Day page will show up here.');
end $$;

-- Only the cron job may run the tick or post; otherwise any signed-in user could make the
-- database post to any URL. (The webhook check constraint is the second guard: pg_net is only
-- ever pointed at discord.com.)
revoke execute on function cadence_reminder_tick() from public, anon, authenticated;
revoke execute on function cadence_post(text, text, text) from public, anon, authenticated;
revoke execute on function cadence_link(day_settings, text) from public, anon, authenticated;
revoke execute on function cadence_msg_before(planned_sessions, day_settings) from public, anon, authenticated;
revoke execute on function cadence_msg_start(planned_sessions, day_settings) from public, anon, authenticated;
revoke execute on function cadence_msg_nudge(planned_sessions, day_settings) from public, anon, authenticated;
revoke execute on function cadence_msg_recap(day_settings) from public, anon, authenticated;
revoke execute on function cadence_send_test() from public, anon;
grant execute on function cadence_send_test() to authenticated;

-- Every minute. Scheduling under the same name replaces the job, so re-running is fine.
select cron.schedule('cadence-reminders', '* * * * *', $$select public.cadence_reminder_tick()$$);
