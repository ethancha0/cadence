// Demo mode has no iCal feeds, so the Week page gets this sample term timetable instead.
import type { CalEvent, CalendarFeed } from "./types";

export const DEMO_CALENDARS: CalendarFeed[] = [
  { id: "demo-classes", name: "Classes", url: "", color: "slate" },
  { id: "demo-zotmeet", name: "ZotMeet team", url: "", color: "teal" },
  { id: "demo-work", name: "Library job", url: "", color: "sage" },
  { id: "demo-tomo", name: "Tomo no Kai", url: "", color: "plum" },
  { id: "demo-personal", name: "Personal", url: "", color: "clay" },
];

// [weekday (0 = Monday), start hour, end hour, calendar, title]
const WEEK: [number, number, number, string, string][] = [
  [0, 9.5, 10 + 50 / 60, "demo-classes", "ICS 46 · Lecture"],
  [0, 11, 12 + 20 / 60, "demo-classes", "STATS 67 · Lecture"],
  [0, 14, 15 + 20 / 60, "demo-classes", "PSYCH 7A · Lecture"],
  [1, 9.5, 10 + 50 / 60, "demo-classes", "ICS 46 · Lecture"],
  [1, 11, 12 + 20 / 60, "demo-classes", "STATS 67 · Lecture"],
  [1, 12 + 20 / 60, 13.5, "demo-personal", "Lunch"],
  [1, 15, 15 + 50 / 60, "demo-classes", "PSYCH 7A · Discussion"],
  [1, 17, 18, "demo-zotmeet", "ZotMeet sync"],
  [1, 18, 19, "demo-personal", "Dinner"],
  [2, 9.5, 10 + 50 / 60, "demo-classes", "ICS 46 · Lecture"],
  [2, 13, 17, "demo-work", "Library shift"],
  [2, 18, 19.5, "demo-tomo", "Board meeting"],
  [3, 11, 12 + 20 / 60, "demo-classes", "STATS 67 · Lecture"],
  [3, 14, 15 + 20 / 60, "demo-classes", "PSYCH 7A · Lecture"],
  [3, 17, 18, "demo-zotmeet", "ZotMeet sync"],
  [4, 9.5, 10 + 50 / 60, "demo-classes", "ICS 46 · Lecture"],
  [4, 13, 16, "demo-work", "Library shift"],
  [4, 19, 22, "demo-tomo", "Tomo no Kai social"],
  [5, 14, 16, "demo-personal", "Band practice"],
  [6, 11, 12, "demo-personal", "Family call"],
];

/** The sample week repeated for every week that overlaps [from, to). */
export function demoEvents(from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = [];
  const monday = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  for (const wk = monday; wk < to; wk.setDate(wk.getDate() + 7)) {
    for (const [day, s, e, calendar, title] of WEEK) {
      const at = (h: number) => new Date(wk.getFullYear(), wk.getMonth(), wk.getDate() + day, 0, Math.round(h * 60));
      const start = at(s), end = at(e);
      if (end <= from || start >= to) continue;
      out.push({ id: `${calendar}:${start.toISOString()}`, calendar, title, start: start.toISOString(), end: end.toISOString(), allDay: false });
    }
  }
  return out;
}
