-- Cadence · Google Calendar connection. Run in the Supabase SQL editor after week.sql. Safe to re-run.
--
-- One row per user who clicked "Connect Google Calendar" in Settings. Which calendars show, and in what
-- colour, lives in day_settings.calendars like the iCal feeds ({ id, name, color, google, off }).
--
-- The refresh token is readable by its owner (RLS, like every table), but it is useless on its own:
-- Google only exchanges it together with GOOGLE_CLIENT_SECRET, which never leaves the server.

create table if not exists google_connections (
  user_id          uuid primary key default auth.uid() references auth.users on delete cascade,
  email            text not null,                 -- the Google account, shown in Settings
  refresh_token    text not null,
  access_token     text,                          -- cached so every Week page load doesn't refresh
  access_expires   timestamptz,
  created_at       timestamptz not null default now()
);

alter table google_connections enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'google_connections' and policyname = 'owner all') then
    create policy "owner all" on google_connections for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
