# Cadence

Spread one work session across several commitments instead of sinking it all into the first task. Pick tasks, set a length, read your notes from last time, take the suggested split, and work in timed blocks with a hard stop. Each hard stop asks for a pro or delta, and those notes come back the next time you pick a task from that category.

Built with Next.js 16 (App Router), TypeScript, and Supabase (Postgres, Auth, RLS).

## Run it locally

```bash
npm install
npm run dev     # http://localhost:3000
```

Without Supabase env vars, Cadence runs in **local demo mode**. Your data lives in this browser's localStorage, preloaded with sample data, and there's no sign-in. Use Settings → *Reset demo data* to start over.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is enough).
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It creates the tables, row-level security (each user sees only their own rows), and the `category_stats` view. Then run [`supabase/week.sql`](supabase/week.sql) for the Week page (safe to re-run; existing projects only need this one).
3. Copy `.env.example` to `.env.local` and fill in **Project Settings → API**: the project URL and the publishable (or anon) key.
4. **Authentication → URL Configuration**: set *Site URL* to your app's origin (`http://localhost:3000` locally, your Vercel/Netlify URL in production) and add `<origin>/auth/callback` to *Redirect URLs*. Sign-up confirmation and password-reset emails land there.
5. Restart `npm run dev`, go to `/signup`, and create your account.
6. Optional, since it's just you: **Authentication → Providers → Email** → turn off *Allow new users to sign up*.

New accounts start empty, so add your categories at the bottom of the **Tasks** page, with a weekly goal for each if you want the Week page to track one.

### Calendars on the Week page

In Google Calendar on the web: **Settings → *your calendar* → Integrate calendar → Secret address in iCal format**. Paste it into Cadence's **Settings → Calendars** and pick a colour. Repeat for each calendar. Cadence only reads these feeds (through `/api/calendar`, which only fetches `calendar.google.com` iCal addresses) and never writes to your calendar. Anyone with a secret address can read that calendar, so treat it like a password. In demo mode the Week page shows a sample timetable instead.

## Deploy (Vercel or Netlify, free tier)

Import the repo, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as environment variables, and deploy. Then update the Supabase Site URL and redirect URL (step 4) to the deployed origin.

**Free-tier caveat:** Supabase pauses free projects after about a week with no activity. While paused, the app can't load data (and the future Claude connector won't answer). Resume the project from the Supabase dashboard.

## How it works

| Where | What |
| --- | --- |
| `lib/split.ts` | The split algorithm (deadline urgency + priority + who got shorted last session). Pure, so the Phase 2 MCP server can reuse it. |
| `lib/store.tsx` | One client-side store: loads all data once, writes through to the backend, derives the live session, schedules the hard stop. |
| `lib/backend.ts` | Supabase backend, plus a localStorage backend for demo mode. |
| `components/SwitchOverlay.tsx` | The full-screen hard stop. Rendered from the root layout, so it appears on any page. |
| `app/(app)/week/page.tsx` | The Week page: calendar events in colour, translucent timeblocks you drag on, move and resize. Each timeblock is a `planned_sessions` row; **Plan & start** fills the Plan page from it. |
| `app/api/calendar/route.ts`, `lib/ical.ts` | Reads the user's iCal feeds server-side and expands recurring events for the requested range. |
| `proxy.ts` | Next 16's middleware: refreshes the Supabase session and redirects signed-out visitors to `/login`. |
| `components/DesktopOverlay.tsx` | The desktop overlay at `/overlay`: current block, session, last note and tasks in one small panel. |
| `desktop/` | The Electron shell that pins `/overlay` to the top-right of your screen. |

- **Timer** is wall-clock based (`session_blocks.resumed_at` + `spent_seconds`), so it survives tab sleep and reloads. Reopening the app mid-session resumes the current block.
- **Quick notes** are saved on the block (`quick_notes`) and prefill the hard-stop form. Hard-stop drafts are kept in localStorage until submitted.
- **Block end** plays a chime and shows a system notification if you allowed notifications (you're asked when you begin a session). Phone push notifications aren't implemented.
- **Require a note at hard stop** is a setting (Settings → Hard stop), on by default.

## Desktop overlay (macOS)

A small panel that floats over your other apps in the top-right corner of the screen. It shows the running block and timer, the session ribbon, your last note for the category, and your tasks. It stays faint until you hover it, clicks pass through it until then, and it turns solid with the hard-stop prompt when a block ends.

```bash
npm run dev               # the app must be running; the overlay loads it
cd desktop && npm install # first time only
npm start                 # or `npm run desktop` from the repo root
```

To install it as an app instead, run `npm run desktop:build` on your Mac (after `cd desktop && npm install`), then drag `desktop/dist/mac-arm64/Cadence.app` (or `dist/mac/` on an Intel Mac) into Applications. The packaged app loads production (`PRODUCTION_URL` in `desktop/main.js`), so no local server is needed. Add it under **System Settings → General → Login Items** to start it when you log in.

- **Signing:** the build signs ad hoc, which needs no Apple Developer account and runs on the Mac that built it. If macOS blocks a copy from another Mac, open it once, then choose **Open Anyway** in **System Settings → Privacy & Security**.
- **⌥⌘K** shows and hides the overlay. **Open Cadence** in its footer opens the full app in a window of its own. That window shares the overlay's sign-in and demo data, so use it rather than your browser in demo mode.
- **Settings** come from environment variables: `CADENCE_URL` (default `http://localhost:3000` with `npm start`, production in the packaged app), `CADENCE_OVERLAY_TONE` (`dark` or `light`), `CADENCE_OVERLAY_OPACITY` (0.5–0.95 when hovered, default 0.72) and `CADENCE_OVERLAY_REST` (0.1–0.6 at rest, default 0.3).
- **Sync:** a change shows up in every open window within a moment. Windows of the same app or browser tell each other after every save. Other devices come through Supabase Realtime, which needs the tables in the `supabase_realtime` publication: the last block of `supabase/schema.sql`. The overlay also re-checks every 15 seconds and on focus. Before a block's hard stop fires, the app re-checks that no other window paused or ended it.
- `/overlay` also works in an ordinary browser tab, without the always-on-top window.

## Not built yet: Phase 2, the Claude connector

The design handoff specifies a remote MCP server (Supabase Edge Function) plus an `/oauth/consent` page using Supabase Auth's OAuth 2.1 server, so Claude can find and edit tasks and notes. The schema and RLS are already set up for it: the connector runs as the signed-in user. `lib/split.ts` is ready to share for the `suggest_split` tool.
