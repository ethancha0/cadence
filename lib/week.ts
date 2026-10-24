// Week-grid maths. Pure: days are 0 = Monday … 6 = Sunday, times are fractional local hours.
import { isoDate, parseIsoDate, startOfWeek } from "./format";

export const SNAP = 0.25; // 15 minutes

export const snap = (h: number) => Math.round(h / SNAP) * SNAP;

/** Monday of the week to open by default: this week, or next week from Saturday on. */
export function defaultWeekStart(now = new Date()): Date {
  const wk = startOfWeek(now);
  if (now.getDay() === 6 || now.getDay() === 0) wk.setDate(wk.getDate() + 7);
  return wk;
}

/** `?w=YYYY-MM-DD` → that week's Monday; anything else → the default week. */
export function weekFromParam(w: string | null, now = new Date()): Date {
  return w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? startOfWeek(parseIsoDate(w)) : defaultWeekStart(now);
}

export const weekParam = (monday: Date) => isoDate(monday);

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** The instant at `hour` on weekday `day` of the week starting `monday` (local time, DST-safe). */
export function atHour(monday: Date, day: number, hour: number): Date {
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, 0, Math.round(hour * 60));
}

/** Which weekday and local hour an instant falls on, relative to `monday`. */
export function toSlot(monday: Date, at: Date): { day: number; hour: number } {
  const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const day = Math.round((midnight.getTime() - monday.getTime()) / 864e5);
  return { day, hour: at.getHours() + at.getMinutes() / 60 };
}

/** "9:30" / "12:00" */
export function clock12(h: number): string {
  const hh = Math.floor(h + 1e-6);
  const mm = Math.round((h - hh) * 60);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")}`;
}

const ampm = (h: number) => (Math.floor(h + 1e-6) % 24 >= 12 ? "PM" : "AM");

/** "3:30 – 5:00 PM", "11:00 AM – 12:20 PM" */
export function hourRange(s: number, e: number): string {
  return `${clock12(s)}${ampm(s) !== ampm(e) ? " " + ampm(s) : ""} – ${clock12(e)} ${ampm(e)}`;
}

/** "9 AM", "12 PM" */
export function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h % 24 >= 12 ? "PM" : "AM"}`;
}

/** "1h 30m", "45m" */
export function hm(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
}

export interface Span {
  day: number;
  start: number;
  end: number;
}

export const overlaps = (a: Span, b: Span) => a.day === b.day && a.start < b.end && a.end > b.start;

/** First 15-minute slot from `from` onward where a block of `hours` fits inside the day and clear of `busy`. */
export function firstFreeSlot(busy: Span[], hours: number, dayStart: number, dayEnd: number, from: { day: number; hour: number }): Span | null {
  for (let day = Math.max(0, from.day); day < 7; day++) {
    const begin = day === from.day ? Math.max(dayStart, Math.ceil(from.hour / SNAP) * SNAP) : dayStart;
    for (let s = begin; s + hours <= dayEnd; s += SNAP) {
      const span = { day, start: s, end: s + hours };
      if (!busy.some((b) => overlaps(span, b))) return span;
    }
  }
  return null;
}
