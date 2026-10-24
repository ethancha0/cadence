// Calendar feeds: colours, URL rules and defaults. Pure, so the API route and the client share it.
import type { CalColor, CalendarFeed, DaySettings, GoogleStatus } from "./types";

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

/**
 * Saved feeds as the app expects them. Feeds saved in docs/day-rail.md's older { name, url } shape have no id or
 * colour; their id falls back to the address, so the API route and the client give the same feed the same id.
 */
export function normalizeFeeds(raw: unknown): CalendarFeed[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Partial<CalendarFeed> => Boolean(f) && typeof f === "object" && (typeof f.url === "string" || typeof f.google === "string"))
    .map((f) => ({
      ...f,
      id: f.id || f.google || f.url!,
      name: f.name || "Calendar",
      url: f.url ?? "",
      color: f.color && CAL_COLORS.includes(f.color) ? f.color : "stone",
    }));
}

/**
 * Brings the Google calendars in `feeds` in step with the connected account: adds new ones (on, in an unused colour),
 * renames, and drops calendars the account no longer has. Colours, on/off and the iCal feeds are kept.
 */
export function mergeGoogleCalendars(feeds: CalendarFeed[], calendars: GoogleStatus["calendars"]): CalendarFeed[] {
  const byId = new Map(calendars.map((c) => [c.id, c]));
  const kept = feeds.flatMap((f) => (!f.google ? [f] : byId.has(f.google) ? [{ ...f, name: byId.get(f.google)!.name }] : []));
  const have = new Set(kept.map((f) => f.google));
  const used = new Set(kept.map((f) => f.color));
  const added = calendars
    .filter((c) => !have.has(c.id))
    .map((c, i): CalendarFeed => {
      const color = CAL_COLORS.find((x) => !used.has(x)) ?? CAL_COLORS[(kept.length + i) % CAL_COLORS.length];
      used.add(color);
      return { id: crypto.randomUUID(), name: c.name, url: "", color, google: c.id };
    });
  return [...kept, ...added];
}

/** "HH:MM" or "HH:MM:SS" → hours as a number (9.5 for 09:30). */
export function timeToHours(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
}
