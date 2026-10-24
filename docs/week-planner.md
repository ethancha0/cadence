# Week planner · handoff

**Branch:** `claude/eager-johnson-x7woia` (not merged). **Status:** built. Lint and `next build` pass. Clicked through in demo mode with Playwright (drag in, move, resize, keyboard, reload, Plan & start), no console errors. **Not yet run against a real Supabase project or real Google iCal feeds**: that's the first job.

Design reference: artboard **B2 · Week horizon** on the private "Cadence — Day Planning & Accountability" canvas. The shipped page follows it.

## What it does

- `/week` (nav: **Week**) shows Mon–Sun between the user's day start and wind-down. Calendar events come from Google's secret iCal feeds, each feed in its own colour. All-day events show as chips under the day name. Calendars can be hidden from the sidebar.
- **Timeblocks.** Drag a category from the sidebar onto the grid. The dashed preview snaps to 15 min. Blocks are translucent gold (`--tb-alpha`), inset 12px so the event under them stays visible, and their label says when they cover something ("over Library shift").
  - Drag to move. Drag the bottom handle to resize. × removes.
  - With a block focused: arrows move, Shift+arrows resize, Delete removes.
  - Pressing a category (no drag) adds 1h in the first free slot.
  - Blocks that have started or passed are locked. Writes happen on drop, never during a drag.
- **Weekly goals:** `categories.weekly_goal_minutes`, edited on Tasks (h / week). The sidebar shows placed / goal per category, and the header shows the week total.
- **Plan & start** appears from 15 min before a block. It calls `planFromBlock` in `lib/store.tsx`, which selects the category's top open tasks (`byDueThenPriority`, 1–4 of them by length), sets the length to the minutes left, and opens `/` with a "From your week" banner. **Begin** marks the block `started`, sets `session_id`, and stores the split in `plan`.
- **Week navigation:** previous / This week / next via `?w=YYYY-MM-DD` (a Monday). With no param it opens the current week, or next week from Saturday on.
- **Demo mode** (no Supabase env) uses `lib/demo-calendar.ts`, a repeating sample timetable.

## Where things are

| File | Role |
| --- | --- |
| `supabase/week.sql` | `day_settings`, `planned_sessions`, `categories.weekly_goal_minutes`, RLS. Idempotent. |
| `app/api/calendar/route.ts` | `GET ?from&to` (≤ 15 days). Reads the user's feeds from `day_settings`. Only fetches `https://calendar.google.com/calendar/ical/…ics` (`isGoogleIcalUrl`). Returns titles and times only. |
| `lib/ical.ts` | `ical.js` expansion: VTIMEZONE registration, RRULE/EXDATE, overridden instances, drops CANCELLED and TRANSPARENT. |
| `lib/useCalendar.ts` | Client fetch per week. Refetches on focus after 5 min. Demo data in local mode. |
| `lib/week.ts` | Pure grid maths: weekday/hour ↔ instant (DST-safe via local `Date`), snapping, overlap, `firstFreeSlot`, labels. |
| `app/(app)/week/page.tsx` | The page: sidebar, grid, pointer and keyboard drag. |
| `components/CalendarSettings.tsx` | Settings → Calendars (address + colour, masked once saved) and Your day (hours). |
| `lib/calendar.ts` | Colour list, URL rule, defaults. Colours are `--cal-<name>-bg/-fg/-sw` in `app/globals.css`. |
| `lib/backend.ts`, `lib/store.tsx`, `lib/types.ts` | `planned` in the snapshot (table `planned_sessions`), `daySettings`, `addPlanned` / `updatePlanned` / `removePlanned`, `setCategoryGoal`, `planFromBlock`, `plan.plannedId`. |

## First: verify against real data

1. In Supabase, run `supabase/week.sql`. Sign in, open `/week`: no errors, empty grid. (The live project had already run `day-rail.sql`, so `planned_sessions` existed without `category_id`; `week.sql` now adds that column too.)
2. Settings → Calendars: paste a real secret iCal address and pick a colour. On `/week`, check:
   - a weekly class repeats on the right days and times;
   - a single moved or cancelled instance shows correctly;
   - an all-day event shows as a chip;
   - a calendar whose secret address was reset in Google shows its error in the sidebar instead of breaking the page.
3. Drop, move, resize and delete blocks, then reload. The rows in `planned_sessions` should match. Set a goal on Tasks and watch the sidebar bar.
4. Create a block starting within 15 min → **Plan & start** → Begin. The row becomes `status = 'started'` with `session_id` set.
5. Check the week across a DST change (`/week?w=2026-11-02`): blocks and events keep their wall-clock times.

Fix anything found there before starting new work.

## Known gaps (in priority order)

1. **Discord reminders.** `supabase/day-rail.sql` (from main) has the reminder job, and the live project already runs it every minute. Its tick links sessions started from `/` to an overlapping block and marks passed blocks `missed`, for week blocks too. The pages its links open (`/session/start`, `/session/catch-up`, `/session/skip`) are in, and work from a week block: until it starts, its tasks come from `splitFor` in `lib/store.tsx`, the same pick as Plan & start. Still missing:
   - Settings has no fields for the Discord webhook, user ID or the `remind_*` switches, so nobody can turn reminders on. The `day_settings` columns exist; `DaySettings` in `lib/types.ts` and `loadDaySettings` don't read them yet.
   - The before/start messages list `plan`, which is empty for a week block until it starts. They should name the category and its top 3 open tasks from SQL (due date, then priority). The recap links to `/day`, which no longer exists: point it at `/week`.
2. **Touch on blocks:** sidebar categories now need a 350 ms still press before they drag on touch, so swipes there scroll. Blocks on the grid still use `touch-action: none`, so a swipe that starts on one moves it instead of scrolling.

Out of scope unless asked: Google OAuth / writing back to Google Calendar, `/day` from `docs/day-rail.md` (the Week page replaced it as the main planner; its page was removed when main was merged in), and the accountability-partner and pledge ideas.

## Ground rules

- Read `AGENTS.md`: Next 16 differs from what you know. Docs are in `node_modules/next/dist/docs/`.
- Keep demo mode working, and keep the two lockfiles in step (`npm install`, then `pnpm install --lockfile-only`).
- Before pushing: `npm run lint` and `npm run build`.
