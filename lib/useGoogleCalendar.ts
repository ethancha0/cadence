"use client";

import { useCallback, useEffect, useState } from "react";
import { mergeGoogleCalendars } from "./calendar";
import { useStore } from "./store";
import type { GoogleStatus } from "./types";

/**
 * The Google Calendar connection (GET /api/google), and the import: every calendar in the connected account
 * gets a feed in day_settings.calendars, so new Google calendars show up on the Week page on their own.
 */
export function useGoogleCalendar() {
  const { ready, mode, daySettings, updateDaySettings } = useStore();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (mode !== "supabase") return;
    let cancelled = false;
    fetch("/api/google")
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
        return body as GoogleStatus;
      })
      .then(
        (s) => !cancelled && setStatus(s),
        (e) => !cancelled && setStatus({ configured: true, email: null, calendars: [], error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [mode, tick]);

  // Once per answer from Google, after the store has loaded (merging into the defaults would wipe the saved feeds).
  useEffect(() => {
    if (!ready || !status?.email || status.error) return;
    const calendars = mergeGoogleCalendars(daySettings.calendars, status.calendars);
    if (JSON.stringify(calendars) !== JSON.stringify(daySettings.calendars)) void updateDaySettings({ ...daySettings, calendars });
    // Not on daySettings: this runs when Google answers, not on every settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const disconnect = useCallback(async () => {
    const r = await fetch("/api/google", { method: "DELETE" });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      throw new Error(body?.error ?? `Disconnect failed (${r.status})`);
    }
    await updateDaySettings({ ...daySettings, calendars: daySettings.calendars.filter((f) => !f.google) });
    setStatus((s) => (s ? { ...s, email: null, calendars: [], error: undefined } : s));
  }, [daySettings, updateDaySettings]);

  return { status, refresh, disconnect };
}
