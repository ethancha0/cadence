"use client";

// The day rail's calendar: /api/calendar (or the seeded demo day), kept in memory per date
// and refetched on window focus once it's more than 5 minutes old.
import { useCallback, useEffect, useState } from "react";
import { dayBounds } from "./day";
import { isoDate } from "./format";
import { seedCalendar } from "./seed";
import type { CalendarStatus, CalEvent, DaySettings } from "./types";

const STALE_MS = 5 * 6e4;

export interface CalendarData {
  events: CalEvent[];
  calendars: CalendarStatus[];
  fetchedAt: number;
}

const cache = new Map<string, CalendarData>();
const inflight = new Map<string, Promise<CalendarData>>(); // one request per key, even when effects run twice
let latest: CalendarData | null = null;

/** The most recent fetch, for Settings' per-calendar event counts. */
export const lastCalendarFetch = () => latest;

async function fetchCalendar(mode: "local" | "supabase", ds: DaySettings, from: string, to: string): Promise<CalendarData> {
  if (mode === "local") {
    return { events: seedCalendar(new Date(from)), calendars: [{ name: "Classes", ok: true }, { name: "Personal", ok: true }], fetchedAt: Date.now() };
  }
  if (!ds.calendars.length) return { events: [], calendars: [], fetchedAt: Date.now() };
  const res = await fetch(`/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 401 ? "You're signed out. Reload to sign in again." : `Calendar request failed (${res.status})`);
  const body = (await res.json()) as Omit<CalendarData, "fetchedAt">;
  return { ...body, fetchedAt: Date.now() };
}

export function useCalendar(date: Date, ds: DaySettings, mode: "local" | "supabase") {
  const { start, end } = dayBounds(date, ds.day_start, ds.wind_down);
  const from = start.toISOString(), to = end.toISOString();
  const key = `${mode}|${from}|${to}|${ds.calendars.map((c) => c.url).join(",")}`;
  const day = isoDate(date);
  const [, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      (inflight.get(key) ?? inflight.set(key, fetchCalendar(mode, ds, from, to).finally(() => inflight.delete(key))).get(key)!).then(
        (data) => {
          cache.set(key, data);
          latest = data;
          setError(null);
          setVersion((v) => v + 1);
        },
        (e) => setError(e instanceof Error ? e.message : String(e)),
      ),
    // `ds.calendars` (all fetchCalendar reads of ds) is folded into `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    const fresh = () => {
      const c = cache.get(key);
      return c && Date.now() - c.fetchedAt < STALE_MS;
    };
    if (!fresh()) void load();
    const onFocus = () => {
      if (!fresh()) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [key, load]);

  const data = cache.get(key) ?? null;
  // All-day events come back with a day's slack; keep the ones covering this date.
  const events = (data?.events ?? []).filter((e) => !e.allDay || (e.start <= day && (e.end > day || e.end === e.start)));
  return { events, calendars: data?.calendars ?? [], fetchedAt: data?.fetchedAt ?? null, loading: !data && !error, error, refresh: load };
}
