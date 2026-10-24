import type { NextRequest } from "next/server";
import { isGoogleIcalUrl, normalizeFeeds } from "@/lib/calendar";
import { accessToken, calendarEvents, errorMessage, getConnection, googleConfigured } from "@/lib/google";
import { eventsInRange } from "@/lib/ical";
import { supabaseConfigured } from "@/lib/supabase/client";
import { createClient } from "@/lib/supabase/server";
import type { CalendarResponse } from "@/lib/types";

const MAX_RANGE_MS = 15 * 864e5;

// GET /api/calendar?from=<ISO>&to=<ISO> — the signed-in user's calendars (connected Google account and iCal feeds), expanded to that range.
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
  const feeds = normalizeFeeds(row?.calendars).filter((f) => !f.off);

  // One access token for every calendar of the connected Google account.
  let google: { token: string } | { error: string } | null = null;
  if (feeds.some((f) => f.google)) {
    try {
      const conn = googleConfigured ? await getConnection(supabase) : null;
      if (!googleConfigured) google = { error: "Google sign-in isn't set up on the server (GOOGLE_CLIENT_ID)" };
      else if (!conn) google = { error: "Google Calendar isn't connected. Connect it in Settings." };
      else google = { token: await accessToken(supabase, conn) };
    } catch (e) {
      google = { error: errorMessage(e) };
    }
  }

  const results = await Promise.all(
    feeds.map(async (f) => {
      if (f.google) {
        if (!google || "error" in google) return { status: { id: f.id, ok: false, error: google?.error }, events: [] };
        try {
          return { status: { id: f.id, ok: true }, events: await calendarEvents(google.token, f.google, f.id, from, to) };
        } catch (e) {
          return { status: { id: f.id, ok: false, error: errorMessage(e) }, events: [] };
        }
      }
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
