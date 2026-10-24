// Calendar feeds: colours, URL rules and defaults. Pure, so the API route and the client share it.
import type { CalColor, DaySettings } from "./types";

/** In picker order. Each maps to --cal-<name>-bg / -fg / -sw in globals.css. */
export const CAL_COLORS: CalColor[] = ["slate", "teal", "sage", "plum", "clay", "indigo", "rose", "stone"];

export const CAL_COLOR_LABEL: Record<CalColor, string> = {
  slate: "Slate", teal: "Teal", sage: "Sage", plum: "Plum", clay: "Clay", indigo: "Indigo", rose: "Rose", stone: "Stone",
};

export const DEFAULT_DAY_SETTINGS: DaySettings = { timezone: "UTC", day_start: "09:00", wind_down: "23:00", calendars: [] };

/**
 * Only Google Calendar's secret iCal addresses are fetched. The server fetches whatever URL is saved,
 * so this is also the guard against pointing it at anything else.
 */
export function isGoogleIcalUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && u.hostname === "calendar.google.com" && u.pathname.startsWith("/calendar/ical/") && u.pathname.endsWith(".ics");
  } catch {
    return false;
  }
}

/** "https://calendar.google.com/calendar/ical/…/private-••••/basic.ics" */
export function maskIcalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const file = u.pathname.split("/").pop();
    return `${u.hostname}/…/private-••••••/${file}`;
  } catch {
    return "Invalid address";
  }
}

/** "HH:MM" or "HH:MM:SS" → hours as a number (9.5 for 09:30). */
export function timeToHours(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
}
