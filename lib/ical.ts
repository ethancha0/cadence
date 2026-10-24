// Server-only: expand an iCal feed into the events that overlap a time range.
import ICAL from "ical.js";
import type { CalEvent } from "./types";

const MAX_OCCURRENCES = 20_000; // a daily event since 2000 is ~10k; stops a runaway RRULE

export function eventsInRange(ics: string, calendarId: string, from: Date, to: Date): CalEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const out: CalEvent[] = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();

  const push = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, key: string) => {
    const status = String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase();
    const transp = String(item.component.getFirstPropertyValue("transp") ?? "").toUpperCase();
    if (status === "CANCELLED" || transp === "TRANSPARENT") return;
    const allDay = start.isDate;
    const s = allDay ? new Date(start.year, start.month - 1, start.day) : start.toJSDate();
    const e = allDay ? new Date(end.year, end.month - 1, end.day) : end.toJSDate();
    if (e.getTime() <= fromMs || s.getTime() >= toMs) return;
    out.push({
      id: `${calendarId}:${item.uid}:${key}`,
      calendar: calendarId,
      title: item.summary || "(No title)",
      start: allDay ? start.toString() : s.toISOString(),
      end: allDay ? end.toString() : e.toISOString(),
      allDay,
    });
  };

  for (const comp of root.getAllSubcomponents("vevent")) {
    // Overrides of single occurrences are related to their master by ICAL.Event and read back through getOccurrenceDetails.
    if (comp.hasProperty("recurrence-id")) continue;
    const ev = new ICAL.Event(comp);
    if (!ev.isRecurring()) {
      if (ev.startDate) push(ev, ev.startDate, ev.endDate ?? ev.startDate, ev.startDate.toString());
      continue;
    }
    const it = ev.iterator();
    for (let n = 0, next = it.next(); next && n < MAX_OCCURRENCES; n++, next = it.next()) {
      if (next.toJSDate().getTime() >= toMs) break;
      const d = ev.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate, next.toString());
    }
  }
  return out;
}
