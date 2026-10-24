# Day rail · v1 handoff

Plan *when* sessions happen, not just what goes in them, and get reminded on Discord when one is due.

**Design:** the "Cadence — Day Planning & Accountability" canvas (private: https://claude.ai/artifact/VwRXpWHWk9fcRz4CTKxQ6v). The artboards for this work:

| Artboard | What it specifies |
| --- | --- |
| **A · Day rail** (`Main.dc.html`) | The `/day` page: calendar rail on the left, selected window and its split on the right |
| **v1 · Settings** | New Settings sections: Calendars, Your day, Reminders on Discord |
| **v1 · Discord reminders** | The four webhook messages, plus the catch-up and skip pages their links open |
| 1 · New-tab start page | Layout reference for `/session/start` (the page the "Open plan" link lands on) |

Everything else on the canvas (week view, day strip, pledge, the generic notification ladder) is exploration and **not** part of v1.

## Decisions already made

- **Calendar = Google's secret iCal address, read-only.** No OAuth, no write-back. Supabase email/password auth stays as it is.
- **Reminders = a Discord webhook into a private channel.** One-way, so every action is a link back into Cadence, never a button.
- **Reminders are sent from Postgres** (`pg_cron` + `pg_net` on Supabase), because nothing in the browser runs when Cadence is closed. Not Vercel cron: the free plan only runs once a day.

## Scope

In:
1. Settings: iCal addresses, day bounds, Discord webhook and reminder toggles.
2. `/day`: rail of today's events and free windows, pick a window, save it as a planned session with a suggested split.
3. Starting a planned session from `/day` or from a reminder link (`/session/start`), with the end time fixed.
4. `/session/catch-up` (log a session you started without Cadence) and `/session/skip` (skip with a reason).
5. Discord messages: 5 min before, at start, a ping 10 min in if nothing's running, and a nightly recap.

Out (later, maybe): Google OAuth / write-back, week view, Discord bot buttons, web push, the accountability partner, the pledge page.

## Before you write code

- Read `AGENTS.md`: this is Next 16, and APIs differ from what you remember. Check `node_modules/next/dist/docs/` for route handlers, `searchParams` (now async) and fetch caching before using them.
- Match the existing code: one client store (`lib/store.tsx`), write-through `Backend` (`lib/backend.ts`), CSS classes from `app/globals.css` (add new ones there, under a `/* day rail */` header), `lucide-react` icons.
- Keep demo mode working (no Supabase env vars → localStorage). See [Demo mode](#demo-mode).
- New dependency: `ical.js` (2.2.x). Nothing else.

## Data

> **Update:** the Week page (`app/(app)/week/page.tsx`) shipped first and already created `day_settings` and `planned_sessions` in `supabase/week.sql`, plus the iCal route, the calendar settings and `planned` in the store. Build on those: add only the columns below that are missing (buffer, minimum window, Discord fields, reminder toggles, `recap_sent_on`, `app_url`) with `alter table … add column if not exists`. `day_settings.calendars` items also carry `id` and `color`.

New file `supabase/day-rail.sql`, run once in the SQL editor after `schema.sql`. Write it idempotently (`if not exists`, `create or replace`) and add a step for it to the README's "Connect Supabase" list.

```sql
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

-- Same owner-only RLS as every other table.
```

Add both tables to the RLS loop's pattern (enable RLS, one `"owner all"` policy).

The webhook URL and iCal addresses are readable by their owner through RLS. That's acceptable for a single-user app. The Settings UI shows them masked anyway (see the Settings artboard).

### Client types

`lib/types.ts`:

```ts
export type PlannedStatus = "planned" | "started" | "caught_up" | "skipped" | "missed";
export interface PlanItem { task_id: string | null; task_title: string; category_id: string; minutes: number; suggested: number }
export interface PlannedSession {
  id: string; starts_at: string; ends_at: string; label: string; until_label: string;
  plan: PlanItem[]; status: PlannedStatus; session_id: string | null; skip_reason: string | null; created_at: string;
}
export interface DaySettings { /* mirrors day_settings minus user_id, recap_sent_on, updated_at */ }
export interface CalEvent { id: string; calendar: string; title: string; start: string; end: string; allDay: boolean }
```

Add `planned: PlannedSession[]` to `Snapshot`, and `planned: "planned_sessions"` to `TABLE` in `lib/backend.ts`, so the existing insert/update/remove paths cover it. `LocalBackend.read()` must default a missing `planned` key to `[]` (existing demo data predates it). The `*_sent_at` columns are server-only: don't select them into the client type.

Add `loadDaySettings()` / `saveDaySettings()` to `Backend`: an upsert on `day_settings` for Supabase, localStorage key `cadence:day:v1` for local. On every save, also write `timezone` (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and `app_url` (`location.origin`).

## Calendar: `app/api/calendar/route.ts`

`GET /api/calendar?from=<ISO>&to=<ISO>`. The client sends the local-day bounds, `day_start` to `wind_down` of the date being shown.

1. Server Supabase client (`lib/supabase/server.ts`) → no user → `401`.
2. Read `calendars` from `day_settings`.
3. **SSRF guard:** only fetch a URL if `protocol === "https:"`, `hostname === "calendar.google.com"` and the pathname starts with `/calendar/ical/` and ends with `.ics`. Validate the same way when saving in Settings, and show an inline error there.
4. Fetch each feed in parallel without caching (read the Next 16 fetch-caching docs, the defaults changed). Use a 10 s timeout. One feed failing must not fail the response.
5. Parse with `ical.js`:
   - register every `VTIMEZONE` before reading times;
   - for recurring masters, `relateException()` each `RECURRENCE-ID` override first, then walk `iterator()` and take `getOccurrenceDetails()` until past `to` (cap at ~2000 iterations);
   - drop `STATUS:CANCELLED` and `TRANSP:TRANSPARENT` (marked "free") events;
   - `DATE`-only starts → `allDay: true`.
6. Return `{ events: CalEvent[], calendars: { name: string; ok: boolean; error?: string }[] }`, with only title, times and calendar name. Never return descriptions, locations or attendees.

The client keeps the result in memory per date and refetches on window focus if it's older than 5 minutes. Show "updated N min ago" (see the rail header).

## Free windows: `lib/day.ts` (pure, no React)

```ts
export interface FreeWindow { start: Date; end: Date; minutes: number; until: string | null } // until = title of the event that ends it; null = wind-down
export function freeWindows(
  events: CalEvent[], planned: PlannedSession[],
  opts: { date: Date; dayStart: string; windDown: string; bufferMinutes: number; minMinutes: number; now: Date },
): FreeWindow[];
export function windowLabel(w: FreeWindow, now: Date): string; // "Now", "Between classes", "Before team sync", "Tonight" (starts ≥ 5 PM)
```

- Busy = timed events plus `planned` sessions that aren't `skipped`/`missed`, clipped to `[dayStart, windDown]` on `date` and merged where they overlap. All-day events are never busy. Show them as chips above the rail.
- Free = the gaps. `end` = gap end − `bufferMinutes` when the gap ends at an event, and exactly `windDown` when it ends the day. For today, `start` = `max(gap start, now rounded up to 5 min)`.
- Floor `minutes` to a multiple of 5. Drop windows under `minMinutes`.
- Everything in the user's timezone. Use `Date` maths on instants, not string slicing. Watch the DST days.

## `/day` page (`app/(app)/day/page.tsx`)

Add **Day** as the first nav link in `components/Nav.tsx`. `/` stays the existing plan-a-session page.

Follow artboard A. Mechanics the mock doesn't show:

- **Rail:** `day_start`–`wind_down`, ~46 px per hour, hour labels every hour. Events in grey (`--color-neutral-200`-ish), with title and time when tall enough, one line when not. Free windows are dashed `<button>`s ("+ Free · 1h 25m"). Saved planned sessions are solid gold ("Session · 1h 25m", plus a status word once it's no longer `planned`). There's a now-line, and the time before now is faded.
- **No calendars configured:** the rail still renders (empty, all one free window) with a line linking to Settings. Feed errors appear as one muted line per failing calendar.
- **Selecting a free window** shows the right panel. Kicker "Session window · {label}", the time range, the "why" sentence (`Ends when {until} starts at {time}. The hard stop leaves you {buffer} minutes.` / `It ends at your {wind_down} wind-down.`), tags (length, block count, hard stop), and a suggested split.
- **Suggested split:** open tasks by `byDueThenPriority`, minus tasks already in another non-skipped planned session today. Take `clamp(floor(minutes / 35), 1, 4)` of them and run `computeSplit(chosen, minutes, ctx)` with the same `ctx` the plan page builds. "Change tasks" opens the to-do picker. Extract the to-do list from `app/page.tsx` into `components/TaskPicker.tsx` and use it in both places, without changing its behaviour on `/`. The ± minute steppers and drag-reorder from `/` are nice to have here, not required.
- **"Remind me on Discord"** checkbox → `planned_sessions.remind`. Shown only when a webhook is set.
- **Save to my day:** inserts the `planned_sessions` row (status `planned`) and selects it. Selecting a saved session shows its plan, with **Start now**, **Edit tasks** and **Remove** (deletes the row).
- **Start now instead** (on an unsaved window): saves, then starts it right away (next section).
- Bottom line: "Today so far: N windows planned · total".

## Starting a planned session

Extend `beginSession(split, opts?: { planned?: PlannedSession; startedAt?: string })` in `lib/store.tsx`:

- **The end time is fixed, the length isn't.** If you start a planned session late, scale its blocks to fit `ends_at − start`. Keep the same tasks and order, re-run `computeSplit` over them with the remaining minutes, and keep any manual overrides proportionally. Under 15 minutes left → don't start; tell the user the window is over.
- `startedAt` (catch-up only) backdates `sessions.started_at` and the first block's `started_at`/`resumed_at`. The wall-clock timer then shows the elapsed time already counted. Clamp it to `[planned.starts_at, now]`.
- After inserting, patch the planned row: `status` = `started` (or `caught_up` when `startedAt` was given) and `session_id`.
- The live session already ends via `SwitchOverlay`. Nothing changes there.

### Landing pages for reminder links

All of these are behind the normal auth proxy, so a signed-out phone goes through `/login?next=…`, which already round-trips.

- **`/session/start?planned=<id>`**: layout from the new-tab artboard. It shows the plan with last-time notes per category (reuse `ProDelta` / `lastNote`) and a big **Start session** button. **Opening the URL must never start anything.** Discord fetches links for previews, and you might tap one by accident. If the row isn't `planned` anymore, say what happened ("Already started at 1:31", "Skipped: Something urgent") and link to `/session` or `/day`.
- **`/session/catch-up?planned=<id>`**: pick the block you're on (default: the first; the chosen one moves to the front), and set "Working since" (`<input type="time">`, default `starts_at`). The button is **Track from {time}** → `beginSession(…, { planned, startedAt })`.
- **`/session/skip?planned=<id>`**: reason radios (Plans changed / Something urgent / Too tired / Other + text). Patch `status = 'skipped'`, `skip_reason`. Skipped rows are already left out of the "tasks planned elsewhere today" exclusion, so their tasks come back into suggestions automatically. Drop the artboard's "put these tasks back" checkbox, or keep it as a plain confirmation line.

Design these phone-first. They'll mostly be opened from the Discord app.

## Reminders (in `supabase/day-rail.sql`)

Two `security definer` functions, `set search_path = public`. **`revoke execute … from public, anon, authenticated`** on the tick function. Otherwise any signed-in user could make the database post to any URL. The `discord_webhook_url` check constraint is the second guard: `pg_net` can only ever be pointed at discord.com.

```sql
-- Runs every minute.
select cron.schedule('cadence-reminders', '* * * * *', $$select public.cadence_reminder_tick()$$);
```

`cadence_reminder_tick()` does, in order:

1. **Link sessions started another way** (e.g. from `/`): a `planned` row whose user has a `sessions` row with `started_at` between `starts_at − 15 min` and `ends_at`, not already linked to another planned row → `status = 'started'`, `session_id`. This stops the nudge firing when you did start, just not through the link.
2. **Mark missed:** `planned` and `ends_at < now()` → `missed`.
3. **Per-session messages** for `planned` rows with `remind` true, of users with a webhook, at most one message per row per tick, and only inside the window it's meant for, so a cron outage never sends stale reminders:
   - **before**: `remind_before`, `before_sent_at is null`, `now() ∈ [starts_at − 5 min, starts_at)`.
   - **start**: `remind_start`, `start_sent_at is null`, `now() ∈ [starts_at, starts_at + 5 min)`.
   - **nudge**: `remind_nudge`, `nudge_sent_at is null`, `now() ∈ [starts_at + 10 min, ends_at)`. Mentions `discord_user_id` if set.

   Set the matching `*_sent_at` in the same statement that sends.
4. **Recap**: users with `remind_recap`, a webhook, local time (`now() at time zone timezone`) ≥ `wind_down`, `recap_sent_on` ≠ local today, and at least one planned row starting local today → send, then set `recap_sent_on`.

Sending: `net.http_post(url := hook, body := jsonb_build_object('content', …, 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', <[id] or []>)))`. With `parse: []`, a task titled "@everyone" can't ping anyone. Escape Discord markdown (`\ * _ ~ | > #` and backticks) in task titles. Format times with `to_char(ts at time zone tz, 'FMHH12:MI AM')`. Write links as `[Open plan](<url>)`. The angle brackets stop Discord unfurling a preview card.

Message copy (from the reminders artboard):

| When | Content |
| --- | --- |
| before | `**Session at 1:30 PM** · 1h 25m, hard stop 2:55` / one line per block: `01 Fix timezone offset in availability grid · 45m` / `[Open plan](<{app}/session/start?planned={id}>)` |
| start | `**Starting now.** {first block short title} first. Hard stop 2:55. [Start session](<…/session/start?planned={id}>)` |
| nudge | `<@{user}> **Nothing's running yet.** Already working on it?` / `[Log it from 1:30](<…/session/catch-up?planned={id}>) · [Start now](<…/session/start?planned={id}>) · [Skip and say why](<…/session/skip?planned={id}>)` |
| recap | `**Today: kept {started+caught_up} of {total} sessions.** {done} of {planned} planned.` / one line per row: `1:30 · caught up at 1:40`, `3:55 · skipped: "Something urgent"`, `7:00 · started on time` (or `started 12 min late`), `missed` / `[See today](<{app}/day>)` |

"Done" minutes = the sum of `session_blocks.spent_seconds` for linked sessions. "Planned" = the sum of `plan[].minutes`.

`cadence_send_test()`: callable by `authenticated` (grant it explicitly). It posts "Cadence is connected. Reminders for sessions you save on the Day page will show up here." to **the caller's own** stored webhook (`where user_id = auth.uid()`). It powers the Settings "Send test message" button. `pg_net` is async, so the button can only say "Sent. Check your channel."

## Settings

Follow the Settings artboard: new sections **Calendars** (list with name + masked URL + event count from the last fetch + Remove; add form; "Where do I find this?" disclosure), **Your day** (day start, wind-down, buffer, shortest window), and **Reminders on Discord** (webhook, optional user ID, four toggles, Save, Send test message). Validate on save: the iCal rule above, and the webhook and user-ID patterns from the SQL constraints.

## Demo mode

No Supabase means no server-side settings and no cron:

- `/day` uses a seeded calendar (`seedCalendar(date)` in `lib/seed.ts`, today's events from artboard A: ICS 46 9:30–10:50, STATS 67 11:00–12:20, Lunch 12:20–1:30, PSYCH 7A Discussion 3:00–3:50, ZotMeet sync 5:00–6:00, Dinner 6:00–7:00) instead of calling `/api/calendar`.
- Planned sessions, starting and catch-up/skip work against localStorage like everything else.
- Settings' Calendars and Discord sections render disabled with "Needs Supabase. See the README."

## Setup to document in the README

1. Run `supabase/day-rail.sql`. If `create extension` is refused, enable **pg_cron** and **pg_net** under Database → Extensions first.
2. Google Calendar (web) → Settings → *your calendar* → Integrate calendar → **Secret address in iCal format** → paste into Cadence Settings. Repeat per calendar.
3. Discord: a private server → a `#cadence` channel → Server Settings → Integrations → Webhooks → New Webhook → Copy URL → paste into Cadence Settings → Send test message. Optional: Developer Mode → right-click yourself → Copy User ID, for pings. Set the channel's notifications to "All messages" so the phone gets every reminder, not just pings.
4. Caveat to note: whether `pg_cron` traffic keeps a free Supabase project from pausing is untested. If the project pauses, reminders stop silently.

## Done when

- [ ] With two real Google iCal addresses, `/day` shows today's events, including a weekly recurring class, a moved single instance of it, and without a cancelled one.
- [ ] Free windows end `buffer` minutes before the next event and at wind-down. Windows under the minimum don't appear. Past time is excluded today.
- [ ] Save → row in `planned_sessions`. Remove → gone. A saved window no longer shows as free.
- [ ] Starting 10 minutes late shrinks the blocks so the session still ends at `ends_at`.
- [ ] With a planned session 6 minutes out, Discord gets the before, start, and (if not started) nudge messages at the right minutes, each once. Starting from `/` instead suppresses the nudge.
- [ ] `/session/start` opened from a link doesn't start anything until the button is pressed.
- [ ] Catch-up backdates correctly: the timer shows elapsed time and the hard stop is unchanged. Skip records the reason. The recap lists both.
- [ ] `select cadence_reminder_tick()` as an `authenticated` user is denied.
- [ ] Demo mode: `/day` works with seeded events, Discord settings are disabled, and nothing else regresses.
- [ ] `npm run lint` and `npm run build` pass.
