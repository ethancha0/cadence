// Persistence. The app keeps a full in-memory snapshot (one user, small data) and
// writes through to a backend: Supabase when configured, otherwise this browser's
// localStorage with demo seed data, so the app runs before Supabase is set up.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_DAY_SETTINGS, normalizeFeeds } from "./calendar";
import { seedSnapshot } from "./seed";
import { createClient, supabaseConfigured } from "./supabase/client";
import type { DaySettings, Settings, Snapshot, Table } from "./types";

export interface Backend {
  mode: "local" | "supabase";
  load(): Promise<Snapshot>;
  insert(table: Table, rows: object[]): Promise<void>;
  update(table: Table, id: string, patch: object): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  loadDaySettings(): Promise<DaySettings>;
  saveDaySettings(s: DaySettings): Promise<void>;
  /** Calls `onChange` when the data changes somewhere else (another device, tab or window). Returns an unsubscribe. */
  subscribe(onChange: () => void): () => void;
}

const DEFAULT_SETTINGS: Settings = { requireNotes: true };

// ---------- Supabase ----------

const TABLE: Record<Table, string> = {
  categories: "categories",
  tasks: "tasks",
  notes: "notes",
  sessions: "sessions",
  blocks: "session_blocks",
  planned: "planned_sessions",
};

/** Postgres `time` comes back as "09:00:00"; the app uses "09:00". */
const hhmm = (t: unknown, fallback: string) => (typeof t === "string" && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : fallback);

class SupabaseBackend implements Backend {
  mode = "supabase" as const;
  constructor(private sb: SupabaseClient) {}

  async load(): Promise<Snapshot> {
    const q = async <T,>(table: Table, order: string, ascending: boolean) => {
      const { data, error } = await this.sb.from(TABLE[table]).select("*").order(order, { ascending });
      if (error) throw error;
      return data as T[];
    };
    const [categories, tasks, notes, sessions, blocks, planned] = await Promise.all([
      q<Snapshot["categories"][number]>("categories", "position", true),
      q<Snapshot["tasks"][number]>("tasks", "created_at", true),
      q<Snapshot["notes"][number]>("notes", "created_at", false),
      q<Snapshot["sessions"][number]>("sessions", "started_at", false),
      q<Snapshot["blocks"][number]>("blocks", "position", true),
      // Before supabase/week.sql has been run, the table doesn't exist yet: the rest of the app still loads.
      q<Snapshot["planned"][number]>("planned", "starts_at", true).catch(() => []),
    ]);
    return { categories, tasks, notes, sessions, blocks, planned };
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

  async loadDaySettings(): Promise<DaySettings> {
    const { data } = await this.sb.from("day_settings").select("timezone, day_start, wind_down, calendars").maybeSingle();
    if (!data) return DEFAULT_DAY_SETTINGS;
    return {
      timezone: data.timezone ?? DEFAULT_DAY_SETTINGS.timezone,
      day_start: hhmm(data.day_start, DEFAULT_DAY_SETTINGS.day_start),
      wind_down: hhmm(data.wind_down, DEFAULT_DAY_SETTINGS.wind_down),
      calendars: normalizeFeeds(data.calendars),
    };
  }

  async saveDaySettings(s: DaySettings) {
    const { data: auth } = await this.sb.auth.getUser();
    if (!auth.user) throw new Error("Signed out");
    const { error } = await this.sb.from("day_settings").upsert({ user_id: auth.user.id, ...s, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  // Needs the tables in the supabase_realtime publication (see the end of supabase/schema.sql).
  subscribe(onChange: () => void) {
    const channel = this.sb.channel("cadence-changes");
    for (const table of Object.values(TABLE)) channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
    channel.subscribe();
    return () => void this.sb.removeChannel(channel);
  }
}

// ---------- localStorage ----------

const DATA_KEY = "cadence:data:v1";
const SETTINGS_KEY = "cadence:settings:v1";
const DAY_KEY = "cadence:day:v1";

class LocalBackend implements Backend {
  mode = "local" as const;
  private data: Snapshot | null = null;

  // Re-read storage every time: another window (the desktop overlay) may have written since.
  // The in-memory copy is only a fallback for when localStorage is unavailable.
  private read(): Snapshot {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Snapshot;
        d.planned ??= []; // saved before the week planner existed
        return (this.data = d);
      }
    } catch {}
    if (this.data) return this.data;
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

  async loadDaySettings(): Promise<DaySettings> {
    try {
      const raw = localStorage.getItem(DAY_KEY);
      if (raw) return { ...DEFAULT_DAY_SETTINGS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_DAY_SETTINGS;
  }

  async saveDaySettings(s: DaySettings) {
    try {
      localStorage.setItem(DAY_KEY, JSON.stringify(s));
    } catch {}
  }

  // Demo data lives in this browser only; other windows of it hear about writes from the store directly.
  subscribe() {
    return () => {};
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
