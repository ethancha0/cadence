// Persistence. The app keeps a full in-memory snapshot (one user, small data) and
// writes through to a backend: Supabase when configured, otherwise this browser's
// localStorage with demo seed data, so the app runs before Supabase is set up.
import type { SupabaseClient } from "@supabase/supabase-js";
import { seedSnapshot } from "./seed";
import { createClient, supabaseConfigured } from "./supabase/client";
import type { Settings, Snapshot, Table } from "./types";

export interface Backend {
  mode: "local" | "supabase";
  load(): Promise<Snapshot>;
  insert(table: Table, rows: object[]): Promise<void>;
  update(table: Table, id: string, patch: object): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
}

const DEFAULT_SETTINGS: Settings = { requireNotes: true };

// ---------- Supabase ----------

const TABLE: Record<Table, string> = {
  categories: "categories",
  tasks: "tasks",
  notes: "notes",
  sessions: "sessions",
  blocks: "session_blocks",
};

class SupabaseBackend implements Backend {
  mode = "supabase" as const;
  constructor(private sb: SupabaseClient) {}

  async load(): Promise<Snapshot> {
    const q = async <T,>(table: Table, order: string, ascending: boolean) => {
      const { data, error } = await this.sb.from(TABLE[table]).select("*").order(order, { ascending });
      if (error) throw error;
      return data as T[];
    };
    const [categories, tasks, notes, sessions, blocks] = await Promise.all([
      q<Snapshot["categories"][number]>("categories", "position", true),
      q<Snapshot["tasks"][number]>("tasks", "created_at", true),
      q<Snapshot["notes"][number]>("notes", "created_at", false),
      q<Snapshot["sessions"][number]>("sessions", "started_at", false),
      q<Snapshot["blocks"][number]>("blocks", "position", true),
    ]);
    return { categories, tasks, notes, sessions, blocks };
  }

  async insert(table: Table, rows: object[]) {
    const { error } = await this.sb.from(TABLE[table]).insert(rows);
    if (error) throw error;
  }

  async update(table: Table, id: string, patch: object) {
    const { error } = await this.sb.from(TABLE[table]).update(patch).eq("id", id);
    if (error) throw error;
  }

  async remove(table: Table, id: string) {
    const { error } = await this.sb.from(TABLE[table]).delete().eq("id", id);
    if (error) throw error;
  }

  async loadSettings(): Promise<Settings> {
    const { data } = await this.sb.auth.getUser();
    const meta = data.user?.user_metadata ?? {};
    return { requireNotes: meta.require_notes ?? DEFAULT_SETTINGS.requireNotes };
  }

  async saveSettings(s: Settings) {
    const { error } = await this.sb.auth.updateUser({ data: { require_notes: s.requireNotes } });
    if (error) throw error;
  }
}

// ---------- localStorage ----------

const DATA_KEY = "cadence:data:v1";
const SETTINGS_KEY = "cadence:settings:v1";

class LocalBackend implements Backend {
  mode = "local" as const;
  private data: Snapshot | null = null;

  private read(): Snapshot {
    if (this.data) return this.data;
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (raw) return (this.data = JSON.parse(raw) as Snapshot);
    } catch {}
    this.data = seedSnapshot();
    this.write();
    return this.data;
  }

  private write() {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(this.data));
    } catch {}
  }

  async load() {
    return structuredClone(this.read());
  }

  async insert(table: Table, rows: object[]) {
    const d = this.read();
    (d[table] as object[]).push(...structuredClone(rows));
    this.write();
  }

  async update(table: Table, id: string, patch: object) {
    const d = this.read();
    const rows = d[table] as { id: string }[];
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows[i] = { ...rows[i], ...structuredClone(patch) };
    this.write();
  }

  async remove(table: Table, id: string) {
    const d = this.read();
    d[table] = (d[table] as { id: string }[]).filter((r) => r.id !== id) as never;
    if (table === "tasks") {
      // Mirror the schema's `on delete set null`.
      d.notes = d.notes.map((n) => (n.task_id === id ? { ...n, task_id: null } : n));
      d.blocks = d.blocks.map((b) => (b.task_id === id ? { ...b, task_id: null } : b));
    }
    this.write();
  }

  async loadSettings(): Promise<Settings> {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_SETTINGS;
  }

  async saveSettings(s: Settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {}
  }

  /** Demo mode only: wipe and re-seed. */
  reset() {
    this.data = seedSnapshot();
    this.write();
  }
}

let backend: Backend | null = null;

export function getBackend(): Backend {
  if (!backend) backend = supabaseConfigured ? new SupabaseBackend(createClient()) : new LocalBackend();
  return backend;
}

export function resetLocalDemo() {
  const b = getBackend();
  if (b instanceof LocalBackend) b.reset();
}
