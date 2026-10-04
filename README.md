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
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It creates the tables, row-level security (each user sees only their own rows), and the `category_stats` view.
3. Copy `.env.example` to `.env.local` and fill in **Project Settings → API**: the project URL and the publishable (or anon) key.
4. **Authentication → URL Configuration**: set *Site URL* to your app's origin (`http://localhost:3000` locally, your Vercel/Netlify URL in production) and add `<origin>/auth/callback` to *Redirect URLs*. Sign-up confirmation and password-reset emails land there.
5. Restart `npm run dev`, go to `/signup`, and create your account.
6. Optional, since it's just you: **Authentication → Providers → Email** → turn off *Allow new users to sign up*.

New accounts start empty, so add your categories at the bottom of the **Tasks** page.

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
| `proxy.ts` | Next 16's middleware: refreshes the Supabase session and redirects signed-out visitors to `/login`. |

- **Timer** is wall-clock based (`session_blocks.resumed_at` + `spent_seconds`), so it survives tab sleep and reloads. Reopening the app mid-session resumes the current block.
- **Quick notes** are saved on the block (`quick_notes`) and prefill the hard-stop form. Hard-stop drafts are kept in localStorage until submitted.
- **Block end** plays a chime and shows a system notification if you allowed notifications (you're asked when you begin a session). Phone push notifications aren't implemented.
- **Require a note at hard stop** is a setting (Settings → Hard stop), on by default.

## Not built yet: Phase 2, the Claude connector

The design handoff specifies a remote MCP server (Supabase Edge Function) plus an `/oauth/consent` page using Supabase Auth's OAuth 2.1 server, so Claude can find and edit tasks and notes. The schema and RLS are already set up for it: the connector runs as the signed-in user. `lib/split.ts` is ready to share for the `suggest_split` tool.
