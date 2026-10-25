export type Priority = "high" | "medium" | "low";

export interface Category {
  id: string;
  name: string;
  position: number;
  archived: boolean;
  created_at: string;
  weekly_goal_minutes?: number | null; // optional: rows saved before the week planner lack it
}

export interface Task {
  id: string;
  category_id: string;
  title: string;
  priority: Priority;
  due_date: string | null; // YYYY-MM-DD
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  category_id: string;
  task_id: string | null;
  task_title: string;
  block_id: string | null;
  pro: string | null;
  delta: string | null;
  pinned: boolean;
  source: "block_end" | "quick" | "manual" | "claude";
  created_at: string;
}

export interface Session {
  id: string;
  planned_minutes: number;
  started_at: string;
  ended_at: string | null;
  pro: string | null;
  delta: string | null;
}

export interface QuickNote {
  kind: "pro" | "delta";
  text: string;
}

export interface Block {
  id: string;
  session_id: string;
  task_id: string | null;
  task_title: string;
  category_id: string;
  position: number;
  planned_minutes: number;
  suggested_minutes: number;
  spent_seconds: number;
  started_at: string | null;
  resumed_at: string | null;
  ended_at: string | null;
  quick_notes: QuickNote[];
}

export type PlannedStatus = "planned" | "started" | "caught_up" | "skipped" | "missed";

export interface PlanItem {
  task_id: string | null;
  task_title: string;
  category_id: string;
  minutes: number;
  suggested: number;
}

/** A timeblock on the Week page: a session planned for a time, with a hard stop at ends_at. */
export interface PlannedSession {
  id: string;
  category_id: string | null;
  starts_at: string;
  ends_at: string;
  label: string;
  until_label: string;
  /** Before the session starts: tasks assigned on the Week page (minutes 0). Once it starts: the split it ran with. */
  plan: PlanItem[];
  status: PlannedStatus;
  session_id: string | null;
  skip_reason: string | null;
  created_at: string;
}

export interface Snapshot {
  categories: Category[];
  tasks: Task[];
  notes: Note[];
  sessions: Session[];
  blocks: Block[];
  planned: PlannedSession[];
}

export type Table = keyof Snapshot;

export interface Settings {
  requireNotes: boolean;
}

export type CalColor = "slate" | "teal" | "sage" | "plum" | "clay" | "indigo" | "rose" | "stone";

/**
 * One calendar on the Week page: either a calendar of the connected Google account (`google` is its
 * calendar id, `url` is "") or an iCal feed (`url` is Google Calendar's "secret address in iCal format").
 */
export interface CalendarFeed {
  id: string;
  name: string;
  url: string;
  color: CalColor;
  google?: string;
  /** Google calendars stay listed when switched off, so the next sync doesn't add them back. */
  off?: boolean;
}

/** What GET /api/google returns. */
export interface GoogleStatus {
  configured: boolean; // GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on the server
  email: string | null; // the connected account, null when not connected
  calendars: { id: string; name: string }[];
  error?: string;
}

export interface DaySettings {
  timezone: string;
  day_start: string; // "HH:MM"
  wind_down: string; // "HH:MM"
  calendars: CalendarFeed[];
}

export interface CalEvent {
  id: string;
  calendar: string; // CalendarFeed.id
  title: string;
  start: string; // ISO instant; YYYY-MM-DD when allDay
  end: string;
  allDay: boolean;
}

/** What /api/calendar returns. */
export interface CalendarResponse {
  events: CalEvent[];
  calendars: { id: string; ok: boolean; error?: string }[];
}
