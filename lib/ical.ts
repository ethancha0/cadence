// iCalendar feed → CalEvent[] between two instants. Server-side (used by /api/calendar).
import ICAL from "ical.js";
import type { CalEvent } from "./types";

const DAY_MS = 864e5;
const MAX_ITERATIONS = 5000; // per recurring event: a daily event reaches back ~13 years

/** YYYY-MM-DD of an ICAL date (all-day) value. */
const dateOnly = (t: ICAL.Time) => `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

const skip = (c: ICAL.Component) =>
  String(c.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED" ||
  String(c.getFirstPropertyValue("transp") ?? "").toUpperCase() === "TRANSPARENT"; // marked "free"

export function parseEvents(ics: string, calendar: string, from: number, to: number): CalEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  // Register every VTIMEZONE first so TZID'd times convert correctly.
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const vevents = root.getAllSubcomponents("vevent");
  const overrides = new Map<string, ICAL.Component[]>();
  const masters: ICAL.Component[] = [];
  for (const v of vevents) {
    if (v.hasProperty("recurrence-id")) {
      const uid = String(v.getFirstPropertyValue("uid"));
      overrides.set(uid, [...(overrides.get(uid) ?? []), v]);
    } else masters.push(v);
  }
  const masterUids = new Set(masters.map((m) => String(m.getFirstPropertyValue("uid"))));

  // All-day events: compare dates with a day's slack either side; the client keeps its own date.
  const fromDay = new Date(from - DAY_MS).toISOString().slice(0, 10);
  const toDay = new Date(to + DAY_MS).toISOString().slice(0, 10);

  const out: CalEvent[] = [];
  const emit = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, id: string) => {
    if (skip(item.component)) return;
    const title = item.summary?.trim() || "Busy";
    if (start.isDate) {
      const s = dateOnly(start);
      const e = end && end.compare(start) > 0 ? dateOnly(end) : s;
      if (s <= toDay && (e > fromDay || s >= fromDay)) out.push({ id, calendar, title, start: s, end: e, allDay: true });
      return;
    }
    const s = start.toJSDate().getTime();
    const e = end ? end.toJSDate().getTime() : s;
    if (s < to && e > from) out.push({ id, calendar, title, start: new Date(s).toISOString(), end: new Date(e).toISOString(), allDay: false });
  };

  for (const m of masters) {
    const uid = String(m.getFirstPropertyValue("uid"));
    const event = new ICAL.Event(m, { strictExceptions: true, exceptions: [] });
    if (!event.isRecurring()) {
      emit(event, event.startDate, event.endDate, uid);
      continue;
    }
    // Moved or edited single instances (RECURRENCE-ID) replace their occurrence.
    for (const o of overrides.get(uid) ?? []) event.relateException(o);
    const it = event.iterator();
    // A moved instance can land in range from an occurrence outside it: walk a day past `to`.
    const stop = to + DAY_MS;
    for (let i = 0, next = it.next(); next && i < MAX_ITERATIONS; i++, next = it.next()) {
      if (next.toJSDate().getTime() > stop) break;
      const d = event.getOccurrenceDetails(next);
      emit(d.item, d.startDate, d.endDate, `${uid}:${d.recurrenceId.toString()}`);
    }
  }

  // Overrides whose series isn't in this feed (shared calendars do this): plain events.
  for (const [uid, list] of overrides) {
    if (masterUids.has(uid)) continue;
    for (const o of list) {
      const e = new ICAL.Event(o);
      emit(e, e.startDate, e.endDate, `${uid}:${String(o.getFirstPropertyValue("recurrence-id"))}`);
    }
  }
  return out;
}
