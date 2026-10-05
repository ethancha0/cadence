"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { chime, notify, primeAlerts } from "./alerts";
import { getBackend } from "./backend";
import { daysSince, startOfWeek } from "./format";
import type { SplitItem } from "./split";
import type { Block, Category, Note, Priority, QuickNote, Session, Settings, Snapshot, Table, Task } from "./types";

const EMPTY: Snapshot = { categories: [], tasks: [], notes: [], sessions: [], blocks: [] };
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

export interface Live {
  session: Session;
  blocks: Block[];
  index: number;
  block: Block;
  next: Block | null;
  phase: "run" | "switch";
}

export interface Plan {
  selected: string[];
  length: number | null; // null = default to last session's planned length
  overrides: Record<string, number>;
  order: string[]; // task ids in user-dragged order; empty = suggested (score) order
}

/** Seconds worked in a block so far (wall-clock based, survives reloads). */
export function elapsedSeconds(b: Block, now = Date.now()): number {
  return b.spent_seconds + (b.resumed_at ? Math.max(0, (now - Date.parse(b.resumed_at)) / 1000) : 0);
}

function useStoreValue() {
  const backend = useMemo(() => (typeof window === "undefined" ? null : getBackend()), []);
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [settings, setSettings] = useState<Settings>({ requireNotes: true });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>({ selected: [], length: null, overrides: {}, order: [] });

  const reload = useCallback(async () => {
    if (!backend) return;
    return Promise.all([backend.load(), backend.loadSettings()]).then(
      ([snap, s]) => {
        setData(snap);
        setSettings(s);
        setError(null);
        setReady(true);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setReady(true);
      },
    );
  }, [backend]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ---------- write-through helpers ----------

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
    setError(`Couldn't save: ${msg}`);
  }, []);

  const add = useCallback(
    <K extends Table>(table: K, rows: Snapshot[K]) => {
      setData((d) => ({ ...d, [table]: [...d[table], ...rows] }));
      return backend!.insert(table, rows).catch(fail);
    },
    [backend, fail],
  );

  const patch = useCallback(
    <K extends Table>(table: K, id: string, p: Partial<Snapshot[K][number]>) => {
      setData((d) => ({ ...d, [table]: (d[table] as { id: string }[]).map((r) => (r.id === id ? { ...r, ...p } : r)) }));
      return backend!.update(table, id, p).catch(fail);
    },
    [backend, fail],
  );

  const drop = useCallback(
    (table: Table, id: string) => {
      setData((d) => ({ ...d, [table]: (d[table] as { id: string }[]).filter((r) => r.id !== id) }));
      return backend!.remove(table, id).catch(fail);
    },
    [backend, fail],
  );

  // ---------- derived ----------

  const derived = useMemo(() => {
    const catById = new Map(data.categories.map((c) => [c.id, c]));
    const taskById = new Map(data.tasks.map((t) => [t.id, t]));
    const categories = [...data.categories].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
    const activeCategories = categories.filter((c) => !c.archived);
    const sessions = [...data.sessions].sort((a, b) => b.started_at.localeCompare(a.started_at));
    const endedSessions = sessions.filter((s) => s.ended_at);
    const lastSession = endedSessions[0] ?? null;
    const blocksBySession = new Map<string, Block[]>();
    for (const b of data.blocks) {
      const list = blocksBySession.get(b.session_id) ?? [];
      list.push(b);
      blocksBySession.set(b.session_id, list);
    }
    blocksBySession.forEach((l) => l.sort((a, b) => a.position - b.position));
    const notes = [...data.notes].sort((a, b) => b.created_at.localeCompare(a.created_at));

    const lastTouched = new Map<string, string>();
    const weekStart = startOfWeek().getTime();
    const week = new Map<string, number>();
    for (const b of data.blocks) {
      if (b.ended_at && (lastTouched.get(b.category_id) ?? "") < b.ended_at) lastTouched.set(b.category_id, b.ended_at);
      if (b.started_at && Date.parse(b.started_at) >= weekStart) {
        week.set(b.category_id, (week.get(b.category_id) ?? 0) + b.spent_seconds / 60);
      }
    }

    /** Minutes spent per category in a session. */
    const sessionAlloc = (sessionId: string): Record<string, number> => {
      const alloc: Record<string, number> = {};
      for (const b of blocksBySession.get(sessionId) ?? []) alloc[b.category_id] = (alloc[b.category_id] ?? 0) + Math.round(b.spent_seconds / 60);
      return alloc;
    };

    // Live session: the one not yet ended. Current block = last one started.
    let live: Live | null = null;
    const open = sessions.find((s) => !s.ended_at);
    const openBlocks = open ? blocksBySession.get(open.id) ?? [] : [];
    if (open && openBlocks.length) {
      let index = 0;
      openBlocks.forEach((b, i) => {
        if (b.started_at) index = i;
      });
      const block = openBlocks[index];
      live = { session: open, blocks: openBlocks, index, block, next: openBlocks[index + 1] ?? null, phase: block.ended_at ? "switch" : "run" };
    }

    return {
      categories,
      activeCategories,
      sessions,
      endedSessions,
      lastSession,
      notes,
      live,
      cat: (id: string): Category | undefined => catById.get(id),
      catName: (id: string) => catById.get(id)?.name ?? "Unknown category",
      task: (id: string | null): Task | undefined => (id ? taskById.get(id) : undefined),
      blocksOf: (sessionId: string) => blocksBySession.get(sessionId) ?? [],
      sessionAlloc,
      lastAlloc: lastSession ? sessionAlloc(lastSession.id) : {},
      daysSinceTouched: (cid: string) => {
        const t = lastTouched.get(cid);
        return t ? daysSince(t) : null;
      },
      weekMinutes: (cid: string) => week.get(cid) ?? 0,
      /** Most recent non-pinned note in a category. */
      lastNote: (cid: string): Note | null => notes.find((n) => n.category_id === cid && !n.pinned && (n.pro || n.delta)) ?? null,
      pinnedFor: (cid: string): Note[] => notes.filter((n) => n.category_id === cid && n.pinned),
    };
  }, [data]);

  const { live } = derived;

  // ---------- categories & tasks ----------

  const addCategory = useCallback(
    (name: string) => {
      const position = Math.max(-1, ...data.categories.map((c) => c.position)) + 1;
      const c: Category = { id: uid(), name, position, archived: false, created_at: nowIso() };
      void add("categories", [c]);
      return c;
    },
    [add, data.categories],
  );

  const addTask = useCallback(
    (input: { title: string; category_id: string; priority: Priority; due_date: string | null }) => {
      const ts = nowIso();
      void add("tasks", [{ id: uid(), ...input, done_at: null, created_at: ts, updated_at: ts }]);
    },
    [add],
  );

  const setTaskDone = useCallback(
    (id: string, done: boolean) => {
      void patch("tasks", id, { done_at: done ? nowIso() : null, updated_at: nowIso() });
      if (done) setPlan((p) => ({ ...p, selected: p.selected.filter((x) => x !== id), overrides: {} }));
    },
    [patch],
  );

  const deleteTask = useCallback(
    (id: string) => {
      setData((d) => ({
        ...d,
        notes: d.notes.map((n) => (n.task_id === id ? { ...n, task_id: null } : n)),
        blocks: d.blocks.map((b) => (b.task_id === id ? { ...b, task_id: null } : b)),
      }));
      setPlan((p) => ({ ...p, selected: p.selected.filter((x) => x !== id), overrides: {} }));
      void drop("tasks", id);
    },
    [drop],
  );

  // ---------- live session ----------

  const beginSession = useCallback(
    async (split: SplitItem<Task>[]) => {
      if (!split.length || live) return;
      primeAlerts();
      const ts = nowIso();
      const session: Session = { id: uid(), planned_minutes: split.reduce((a, s) => a + s.minutes, 0), started_at: ts, ended_at: null, pro: null, delta: null };
      const blocks: Block[] = split.map((s, i) => ({
        id: uid(), session_id: session.id, task_id: s.task.id, task_title: s.task.title, category_id: s.task.category_id, position: i,
        planned_minutes: s.minutes, suggested_minutes: s.suggested, spent_seconds: 0,
        started_at: i === 0 ? ts : null, resumed_at: i === 0 ? ts : null, ended_at: null, quick_notes: [],
      }));
      setData((d) => ({ ...d, sessions: [...d.sessions, session], blocks: [...d.blocks, ...blocks] }));
      try {
        await backend!.insert("sessions", [session]);
        await backend!.insert("blocks", blocks);
      } catch (e) {
        fail(e);
      }
    },
    [backend, fail, live],
  );

  const pause = useCallback(() => {
    if (!live || !live.block.resumed_at) return;
    void patch("blocks", live.block.id, { spent_seconds: Math.round(elapsedSeconds(live.block)), resumed_at: null });
  }, [live, patch]);

  const resume = useCallback(() => {
    if (!live || live.block.resumed_at || live.phase !== "run") return;
    void patch("blocks", live.block.id, { resumed_at: nowIso() });
  }, [live, patch]);

  const endBlock = useCallback(
    (reason: "timer" | "early") => {
      if (!live || live.phase !== "run") return;
      const b = live.block;
      const planned = b.planned_minutes * 60;
      const spent = reason === "timer" ? planned : Math.min(planned, Math.round(elapsedSeconds(b)));
      void patch("blocks", b.id, { spent_seconds: spent, resumed_at: null, ended_at: nowIso() });
      if (reason === "timer") {
        chime();
        notify("Time to put this down.", `${b.task_title} — write a pro or delta before you switch.`);
      }
    },
    [live, patch],
  );

  // Hard stop: schedule the block end at the wall-clock moment the timer reaches 0.
  const endRef = useRef(endBlock);
  useEffect(() => {
    endRef.current = endBlock;
  }, [endBlock]);
  const runningBlock = live && live.phase === "run" && live.block.resumed_at ? live.block : null;
  useEffect(() => {
    if (!runningBlock) return;
    const remainingMs = () => (runningBlock.planned_minutes * 60 - elapsedSeconds(runningBlock)) * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const ms = remainingMs();
      if (ms <= 0) endRef.current("timer");
      else timer = setTimeout(check, Math.min(ms, 30_000)); // re-check; background tabs throttle timers
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [runningBlock]);

  const addQuickNote = useCallback(
    (q: QuickNote) => {
      if (!live) return;
      void patch("blocks", live.block.id, { quick_notes: [...live.block.quick_notes, q] });
    },
    [live, patch],
  );

  /** Save the block-end note, then start the next block or end the session. Returns the session id when it ends. */
  const finishBlock = useCallback(
    (pro: string, delta: string): string | null => {
      if (!live || live.phase !== "switch") return null;
      const b = live.block;
      if (pro || delta) {
        const t = derived.task(b.task_id);
        void add("notes", [{
          id: uid(), category_id: b.category_id, task_id: b.task_id, task_title: t?.title ?? b.task_title, block_id: b.id,
          pro: pro || null, delta: delta || null, pinned: false, source: "block_end", created_at: nowIso(),
        }]);
      }
      if (live.next) {
        const ts = nowIso();
        void patch("blocks", live.next.id, { started_at: ts, resumed_at: ts });
        return null;
      }
      void patch("sessions", live.session.id, { ended_at: nowIso() });
      return live.session.id;
    },
    [add, derived, live, patch],
  );

  const saveReflection = useCallback(
    (sessionId: string, pro: string, delta: string) => {
      void patch("sessions", sessionId, { pro: pro || null, delta: delta || null });
      setPlan({ selected: [], length: null, overrides: {}, order: [] });
    },
    [patch],
  );

  // ---------- notes & settings ----------

  const togglePin = useCallback(
    (id: string) => {
      const n = data.notes.find((x) => x.id === id);
      if (n) void patch("notes", id, { pinned: !n.pinned });
    },
    [data.notes, patch],
  );

  const updateSettings = useCallback(
    (s: Settings) => {
      setSettings(s);
      backend?.saveSettings(s).catch(fail);
    },
    [backend, fail],
  );

  return {
    ready,
    error,
    clearError: () => setError(null),
    mode: backend?.mode ?? "local",
    data,
    settings,
    plan,
    setPlan,
    reload,
    ...derived,
    addCategory,
    renameCategory: (id: string, name: string) => void patch("categories", id, { name }),
    setCategoryArchived: (id: string, archived: boolean) => void patch("categories", id, { archived }),
    addTask,
    setTaskDone,
    deleteTask,
    beginSession,
    pause,
    resume,
    endBlock,
    addQuickNote,
    finishBlock,
    saveReflection,
    togglePin,
    updateSettings,
  };
}

export type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}

/** Re-renders on an interval while `active`; returns the latest tick's Date.now(). */
export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [active, ms]);
  return now;
}
