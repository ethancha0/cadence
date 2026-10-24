import type { NextRequest } from "next/server";
import { isGoogleIcalUrl } from "@/lib/calendar";
import { eventsInRange } from "@/lib/ical";
import { supabaseConfigured } from "@/lib/supabase/client";
import { createClient } from "@/lib/supabase/server";
import type { CalendarFeed, CalendarResponse } from "@/lib/types";

const MAX_RANGE_MS = 15 * 864e5;

// GET /api/calendar?from=<ISO>&to=<ISO> — the signed-in user's iCal feeds, expanded to that range.
// Only titles and times leave the server; descriptions, locations and attendees are dropped.
export async function GET(request: NextRequest) {
  if (!supabaseConfigured) return Response.json({ error: "Calendars need Supabase" }, { status: 404 });

  const from = new Date(request.nextUrl.searchParams.get("from") ?? "");
  const to = new Date(request.nextUrl.searchParams.get("to") ?? "");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return Response.json({ error: "Bad range" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return Response.json({ error: "Signed out" }, { status: 401 });

  const { data: row, error } = await supabase.from("day_settings").select("calendars").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const feeds = ((row?.calendars ?? []) as CalendarFeed[]).filter((f) => f && typeof f.url === "string");

  const results = await Promise.all(
    feeds.map(async (f) => {
      if (!isGoogleIcalUrl(f.url)) return { status: { id: f.id, ok: false, error: "Not a Google Calendar iCal address" }, events: [] };
      try {
        const res = await fetch(f.url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { status: { id: f.id, ok: false, error: `Google answered ${res.status}` }, events: [] };
        return { status: { id: f.id, ok: true }, events: eventsInRange(await res.text(), f.id, from, to) };
      } catch (e) {
        const msg = e instanceof Error && e.name === "TimeoutError" ? "Timed out" : "Couldn't read this calendar";
        return { status: { id: f.id, ok: false, error: msg }, events: [] };
      }
    }),
  );

  return Response.json({
    events: results.flatMap((r) => r.events),
    calendars: results.map((r) => r.status),
  } satisfies CalendarResponse);
}
