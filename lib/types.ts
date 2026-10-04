export type Priority = "high" | "medium" | "low";

export interface Category {
  id: string;
  name: string;
  position: number;
  archived: boolean;
  created_at: string;
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

export interface Snapshot {
  categories: Category[];
  tasks: Task[];
  notes: Note[];
  sessions: Session[];
  blocks: Block[];
}

export type Table = keyof Snapshot;

export interface Settings {
  requireNotes: boolean;
}
