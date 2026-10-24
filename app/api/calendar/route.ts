// GET /api/calendar?from=<ISO>&to=<ISO>: the signed-in user's Google calendars (secret iCal
// addresses from day_settings), expanded into events between `from` and `to`. Read-only, and
// only titles and times leave the server.
import { isIcalUrl } from "@/lib/day";
import { parseEvents } from "@/lib/ical";
import { createClient } from "@/lib/supabase/server";
import type { CalendarFeed, CalendarStatus, CalEvent } from "@/lib/types";

const DAY_MS = 864e5;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = Date.parse(params.get("from") ?? "");
  const to = Date.parse(params.get("to") ?? "");
  if (isNaN(from) || isNaN(to) || to <= from || to - from > 7 * DAY_MS) {
    return Response.json({ error: "Pass from and to as ISO times, at most a week apart." }, { status: 400 });
  }

  const { data: row, error } = await supabase.from("day_settings").select("calendars").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const feeds: CalendarFeed[] = Array.isArray(row?.calendars) ? row.calendars : [];

  const results = await Promise.all(feeds.map((f) => readFeed(f, from, to)));
  return Response.json({
    events: results.flatMap((r) => r.events),
    calendars: results.map((r) => r.status),
  } satisfies { events: CalEvent[]; calendars: CalendarStatus[] });
}

// Google rate-limits secret iCal feeds (429), so each feed's text is kept in memory for a few
// minutes, and after a 429 nothing is sent to Google until its Retry-After (or 10 minutes) passes.
// Per server instance, so on serverless it softens the load rather than guaranteeing it.
const FRESH_MS = 3 * 6e4;
const BACKOFF_MS = 10 * 6e4;
const feeds = new Map<string, { text: string | null; at: number; retryAfter: number }>();

async function feedText(url: string): Promise<{ text: string; stale: boolean } | { status: number; retryAt?: number }> {
  const now = Date.now();
  const hit = feeds.get(url);
  if (hit?.text && now - hit.at < FRESH_MS) return { text: hit.text, stale: false };
  if (hit && now < hit.retryAfter) return hit.text ? { text: hit.text, stale: true } : { status: 429, retryAt: hit.retryAfter };

  const res = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (res.status === 429) {
    const secs = Number(res.headers.get("retry-after"));
    const retryAfter = now + (secs > 0 ? secs * 1000 : BACKOFF_MS);
    feeds.set(url, { text: hit?.text ?? null, at: hit?.at ?? 0, retryAfter });
    return hit?.text ? { text: hit.text, stale: true } : { status: 429, retryAt: retryAfter };
  }
  if (!res.ok) return { status: res.status };
  const text = await res.text();
  feeds.set(url, { text, at: now, retryAfter: 0 });
  return { text, stale: false };
}

async function readFeed(feed: CalendarFeed, from: number, to: number): Promise<{ events: CalEvent[]; status: CalendarStatus }> {
  const fail = (error: string) => ({ events: [], status: { name: feed.name, ok: false, error } });
  // SSRF guard: never fetch anything but a Google secret iCal address.
  if (!isIcalUrl(feed.url)) return fail("Not a Google Calendar iCal address");
  try {
    const got = await feedText(feed.url);
    if ("status" in got) {
      if (got.status === 404) {
        // Google 404s both a public address for a calendar that isn't public and a stale secret address.
        return fail(
          new URL(feed.url).pathname.includes("/public/")
            ? "This is the calendar's public address, and the calendar isn't public. Use its Secret address in iCal format instead."
            : "Google doesn't recognize this address. Copy the Secret address in iCal format again; it changes if it's reset.",
        );
      }
      if (got.status === 429) {
        const mins = got.retryAt ? Math.max(1, Math.ceil((got.retryAt - Date.now()) / 6e4)) : 10;
        return fail(`Google is limiting how often this calendar can be read. Cadence will try again in about ${mins} min.`);
      }
      return fail(`Google answered ${got.status}`);
    }
    const events = parseEvents(got.text, feed.name, from, to);
    return { events, status: { name: feed.name, ok: true } };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return fail(timeout ? "Timed out after 10 seconds" : "Couldn't read this calendar");
  }
}
