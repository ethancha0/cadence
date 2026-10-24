"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_CALENDARS, demoEvents } from "./demo-calendar";
import type { CalendarFeed, CalendarResponse, CalEvent } from "./types";

const STALE_MS = 5 * 6e4;

export interface CalendarState {
  feeds: CalendarFeed[];
  events: CalEvent[];
  status: CalendarResponse["calendars"];
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  refresh: () => void;
}

/** Events from the user's iCal feeds between `from` and `to`. Demo mode returns the sample timetable. */
export function useCalendar(mode: "local" | "supabase", feeds: CalendarFeed[], from: Date, to: Date): CalendarState {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const demo = mode === "local";
  const feedKey = feeds.map((f) => f.id + f.url).join("|");
  const [state, setState] = useState<{ key: string; res: CalendarResponse | null; error: string | null; at: number | null }>({ key: "", res: null, error: null, at: null });
  const [tick, setTick] = useState(0);
  const key = `${fromIso}|${toIso}|${feedKey}`; // a refresh (tick) refetches but keeps showing the old events meanwhile

  useEffect(() => {
    if (demo || !feeds.length) return;
    let cancelled = false;
    fetch(`/api/calendar?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Calendar request failed (${r.status})`);
        return body as CalendarResponse;
      })
      .then(
        (res) => !cancelled && setState({ key, res, error: null, at: Date.now() }),
        (e) => !cancelled && setState({ key, res: null, error: e instanceof Error ? e.message : String(e), at: Date.now() }),
      );
    return () => {
      cancelled = true;
    };
    // key stands in for feeds, from and to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, demo]);

  // Refetch when the tab comes back after a while, so edits made in Google show up.
  const at = state.at;
  useEffect(() => {
    if (demo) return;
    const onFocus = () => at && Date.now() - at > STALE_MS && setTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [at, demo]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  if (demo) {
    return { feeds: DEMO_CALENDARS, events: demoEvents(from, to), status: [], loading: false, error: null, updatedAt: null, refresh };
  }
  const current = state.key === key;
  return {
    feeds,
    events: current ? state.res?.events ?? [] : [],
    status: current ? state.res?.calendars ?? [] : [],
    loading: feeds.length > 0 && !current,
    error: current ? state.error : null,
    updatedAt: state.at,
    refresh,
  };
}
