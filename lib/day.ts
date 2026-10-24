// Times and statuses for the pages reminder links open (/session/start, /catch-up, /skip). Pure, no React.
// Times are the browser's local time, which is the user's timezone (Settings writes it to day_settings).
import type { PlannedSession, PlannedStatus } from "./types";

// ---------- times ----------

/** `date`'s calendar day at local "HH:MM". */
export function atTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0);
}

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
