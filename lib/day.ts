// The day rail's maths: free windows between calendar events, and the validators shared
// by Settings and /api/calendar. Pure, no React. Times are the browser's local time,
// which is the user's timezone (Settings writes it to day_settings for the reminder job).
import type { CalEvent, DaySettings, PlannedSession, PlannedStatus } from "./types";

const MIN = 6e4;

export const DEFAULT_DAY_SETTINGS: DaySettings = {
  timezone: "UTC",
  day_start: "09:00",
  wind_down: "22:00",
  buffer_minutes: 5,
  min_window_minutes: 30,
  calendars: [],
  discord_webhook_url: null,
  discord_user_id: null,
  app_url: null,
  remind_before: true,
  remind_start: true,
  remind_nudge: true,
  remind_recap: true,
};

// ---------- validation (mirrors the SQL check constraints) ----------

/** Only Google's secret iCal addresses: the server fetches these, so nothing else gets through. */
export function isIcalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      u.hostname === "calendar.google.com" &&
      !u.port &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith("/calendar/ical/") &&
      u.pathname.endsWith(".ics")
    );
  } catch {
    return false;
  }
}

export const WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/;
export const DISCORD_ID_RE = /^[0-9]{15,22}$/;

/** "calendar.google.com/…/private-••••••••/basic.ics" */
export function maskIcal(raw: string): string {
  try {
    const parts = new URL(raw).pathname.split("/");
    const file = parts.pop() ?? "";
    const secret = parts.pop() ?? "";
    return `calendar.google.com/…/${secret.startsWith("private-") ? "private-" : ""}••••••••/${file}`;
  } catch {
    return "••••••••";
  }
}

/** "https://discord.com/api/webhooks/1290…/••••••••••••" */
export function maskWebhook(raw: string): string {
  const m = raw.match(/^(https:\/\/[^/]+\/api\/webhooks\/)([0-9]{4})[0-9]*\//);
  return m ? `${m[1]}${m[2]}…/••••••••••••` : "••••••••••••";
}

// ---------- times ----------

/** `date`'s calendar day at local "HH:MM". */
export function atTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0);
}

/** The rail's bounds on `date`. A wind-down at or before the day start means after midnight. */
export function dayBounds(date: Date, dayStart: string, windDown: string): { start: Date; end: Date } {
  const start = atTime(date, dayStart);
  const end = atTime(date, windDown);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

const ceil5 = (d: Date) => new Date(Math.ceil(d.getTime() / (5 * MIN)) * 5 * MIN);

/** "1:30 PM" */
export function clockTime(d: Date | string | number): string {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "2:55" (no meridiem), for hard stops in running text. */
export function shortClock(d: Date | string): string {
  return clockTime(d).replace(/\s?[AP]M$/, "");
}

/** "1:30 – 2:55 PM", or "11:00 AM – 12:20 PM" across noon. */
export function timeRange(a: Date | string, b: Date | string): string {
  const x = clockTime(a), y = clockTime(b);
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}`;
}

/** "1h 25m", "45m", "3h" */
export function lenLabel(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
}

/** "HH:MM" for an <input type="time">. */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------- planned sessions ----------

/** Planned sessions that still hold their time (and their tasks). */
export const holdsTime = (p: Pick<PlannedSession, "status">) => p.status !== "skipped" && p.status !== "missed";

/** What to show: the reminder job marks a window missed once it ends, but demo mode has no job. */
export function displayStatus(p: PlannedSession, now: Date): PlannedStatus {
  return p.status === "planned" && Date.parse(p.ends_at) < now.getTime() ? "missed" : p.status;
}

export function sameDay(a: Date | string, b: Date): boolean {
  const d = new Date(a);
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate();
}

// ---------- free windows ----------

/** What a window "runs into" when the next busy thing is one of your own planned sessions. */
export const PLANNED_TITLE = "your next session";

export interface FreeWindow {
  start: Date;
  end: Date;
  minutes: number;
  until: string | null; // title of the event that ends it; null = wind-down
  after: string | null; // title of the event before it; null = day start (or now)
}

interface Busy {
  start: number;
  end: number;
  title: string;
}

export function freeWindows(
  events: CalEvent[],
  planned: PlannedSession[],
  opts: { date: Date; dayStart: string; windDown: string; bufferMinutes: number; minMinutes: number; now: Date },
): FreeWindow[] {
  const { start: S, end: W } = dayBounds(opts.date, opts.dayStart, opts.windDown);
  const s0 = S.getTime(), w0 = W.getTime();

  const busy: Busy[] = [
    ...events.filter((e) => !e.allDay).map((e) => ({ start: Date.parse(e.start), end: Date.parse(e.end), title: e.title })),
    ...planned.filter(holdsTime).map((p) => ({ start: Date.parse(p.starts_at), end: Date.parse(p.ends_at), title: PLANNED_TITLE })),
  ]
    .filter((b) => b.start < w0 && b.end > s0)
    .map((b) => ({ ...b, start: Math.max(b.start, s0), end: Math.min(b.end, w0) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  // Merge overlaps; a merged run keeps its first interval's title (that's what a gap before it runs into).
  const merged: Busy[] = [];
  for (const b of busy) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }

  const gaps: { start: number; end: number; until: Busy | null; after: Busy | null }[] = [];
  let cursor = s0;
  let prev: Busy | null = null;
  for (const b of merged) {
    if (b.start > cursor) gaps.push({ start: cursor, end: b.start, until: b, after: prev });
    cursor = Math.max(cursor, b.end);
    prev = b;
  }
  if (cursor < w0) gaps.push({ start: cursor, end: w0, until: null, after: prev });

  const earliest = ceil5(opts.now).getTime();
  const out: FreeWindow[] = [];
  for (const g of gaps) {
    const start = Math.max(g.start, earliest);
    const end = g.until ? g.end - opts.bufferMinutes * MIN : g.end;
    const minutes = Math.floor((end - start) / MIN / 5) * 5;
    if (minutes < opts.minMinutes) continue;
    out.push({
      start: new Date(start),
      end: new Date(end),
      minutes,
      until: g.until?.title ?? null,
      after: start === g.start ? g.after?.title ?? null : null,
    });
  }
  return out;
}

/** The part of an event title after its last " · " ("ZotMeet · Team sync" → "Team sync"). */
const shortTitle = (t: string) => t.split(" · ").pop()!.trim();

/** "Now", "Tonight", "This morning", "Before Team sync", "This afternoon". */
export function windowLabel(w: FreeWindow, now: Date): string {
  if (w.start.getTime() - now.getTime() < 5 * MIN) return "Now";
  if (w.start.getHours() >= 17) return "Tonight";
  if (!w.after && w.start.getHours() < 12) return "This morning";
  if (w.until && w.until !== PLANNED_TITLE) return `Before ${shortTitle(w.until)}`;
  return "This afternoon";
}

/** A stable id for a free window while `now` moves its start. */
export const windowKey = (w: FreeWindow) => `${w.end.getTime()}`;
