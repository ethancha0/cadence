import type { Priority, Task } from "./types";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 864e5;

export const PRIO_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
export const PRIO_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const PRIO_CLASS: Record<Priority, string> = { high: "tag-accent", medium: "tag-outline", low: "tag-neutral" };

/** Due date ascending (no date last), then priority high → low. */
export const byDueThenPriority = (a: Pick<Task, "due_date" | "priority">, b: Pick<Task, "due_date" | "priority">) =>
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || PRIO_RANK[b.priority] - PRIO_RANK[a.priority];

export function startOfDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local YYYY-MM-DD, for <input type="date"> and due_date columns. */
export function isoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from today until a YYYY-MM-DD date (negative = past). */
export function daysUntil(due: string | null, today = startOfDay()): number | null {
  if (!due) return null;
  return Math.round((parseIsoDate(due).getTime() - today.getTime()) / DAY_MS);
}

/** Whole calendar days since a timestamp. */
export function daysSince(ts: string, today = startOfDay()): number {
  return Math.max(0, Math.round((today.getTime() - startOfDay(new Date(ts)).getTime()) / DAY_MS));
}

export function dueLabel(due: string | null): string {
  const d = daysUntil(due);
  if (d == null) return "No due date";
  if (d < 0) return `Overdue · ${-d} day${d === -1 ? "" : "s"}`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due ${WD[parseIsoDate(due!).getDay()]} · ${d} days`;
}

export function dueSoon(due: string | null): boolean {
  const d = daysUntil(due);
  return d != null && d <= 1;
}

export function sinceLabel(n: number | null): string {
  if (n == null) return "Not touched yet";
  if (n === 0) return "Touched today";
  if (n === 1) return "Last touched yesterday";
  return `Last touched ${n} days ago`;
}

export function fmtMin(m: number): string {
  m = Math.round(m);
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? " " + r + " min" : ""}` : `${r} min`;
}

export function shortMin(m: number): string {
  return fmtMin(m).replace(" min", "m").replace(" h", "h");
}

/** "Sat Oct 3" */
export function shortDate(ts: string): string {
  const d = new Date(ts);
  return `${WD[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
}

/** "Sunday, October 4" */
export function longDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function clock(seconds: number): string {
  const r = Math.max(0, Math.ceil(seconds));
  return `${pad2(Math.floor(r / 60))}:${pad2(r % 60)}`;
}

/** Monday 00:00 of the current week (matches Postgres date_trunc('week')). */
export function startOfWeek(d: Date = new Date()): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}
