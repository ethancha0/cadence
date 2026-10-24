"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { chime, notify, primeAlerts } from "./alerts";
import { getBackend } from "./backend";
import { DEFAULT_DAY_SETTINGS } from "./calendar";
import { byDueThenPriority, daysSince, startOfWeek } from "./format";
import { computeSplit, type SplitItem } from "./split";
import type { Block, Category, DaySettings, Note, PlannedSession, Priority, QuickNote, Session, Settings, Snapshot, Table, Task } from "./types";

const EMPTY: Snapshot = { categories: [], tasks: [], notes: [], sessions: [], blocks: [], planned: [] };
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
  plannedId?: string; // set when the plan was opened from a Week timeblock; begin links the session to it
}

/** Minutes a timeblock still has before its hard stop, floored to 5 (its full length if it hasn't started). */
export function minutesLeft(p: Pick<PlannedSession, "starts_at" | "ends_at">, now = Date.now()): number {
  const from = Math.max(now, Date.parse(p.starts_at));
  return Math.max(0, Math.floor((Date.parse(p.ends_at) - from) / 6e4 / 5) * 5);
}

/** Seconds worked in a block so far (wall-clock based, survives reloads). */
export function elapsedSeconds(b: Block, now = Date.now()): number {
  return b.spent_seconds + (b.resumed_at ? Math.max(0, (now - Date.parse(b.resumed_at)) / 1000) : 0);
}

export interface StoreOptions {
  /** Re-fetch on this interval (ms) in Supabase mode. Local mode syncs through storage events instead. */
  poll?: number;
}

function useStoreValue({ poll }: StoreOptions = {}) {
  const backend = useMemo(() => (typeof window === "undefined" ? null : getBackend()), []);
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [settings, setSettings] = useState<Settings>({ requireNotes: true });
  const [daySettings, setDaySettings] = useState<DaySettings>(DEFAULT_DAY_SETTINGS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>({ selected: [], length: null, overrides: {}, order: [] });

  // Writes are optimistic, so a load that overlaps one could hand back rows from before it. Bumped on every write.
  const writes = useRef({ gen: 0, pending: 0 });

  const reload = useCallback(async () => {
    if (!backend) return;
    const gen = writes.current.gen;
    return Promise.all([backend.load(), backend.loadSettings(), backend.loadDaySettings().catch(() => DEFAULT_DAY_SETTINGS)]).then(
      ([snap, s, day]) => {
        if (gen !== writes.current.gen || writes.current.pending) return;
        setData(snap);
        setSettings(s);
        setDaySettings(day);
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

  // Other windows and devices change the same data (the desktop overlay, another tab, a phone): pick it up.
  // Windows of this browser hear about each write straight away through `sync`; others through the backend.
  const sync = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!backend) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 150); // one reload for a burst of changes
    };
    const onVisible = () => document.visibilityState === "visible" && refresh();
    const channel = new BroadcastChannel("cadence:sync");
    channel.onmessage = refresh;
    sync.current = channel;
    const unsubscribe = backend.subscribe(refresh);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const iv = poll && backend.mode === "supabase" ? setInterval(onVisible, poll) : undefined;
    return () => {
      clearTimeout(timer);
      clearInterval(iv);
      channel.close();
      sync.current = null;
      unsubscribe();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [backend, poll, reload]);

  // ---------- write-through helpers ----------

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
    setError(`Couldn't save: ${msg}`);
  }, []);

  const track = useCallback(
    (write: Promise<void>) => {
      const w = writes.current;
      w.gen++;
      w.pending++;
      return write.catch(fail).finally(() => {
        w.pending--;
        sync.current?.postMessage("changed");
      });
    },
    [fail],
  );

  const add = useCallback(
    <K extends Table>(table: K, rows: Snapshot[K]) => {
      setData((d) => ({ ...d, [table]: [...d[table], ...rows] }));
      return track(backend!.insert(table, rows));
    },
    [backend, track],
  );

  const patch = useCallback(
    <K extends Table>(table: K, id: string, p: Partial<Snapshot[K][number]>) => {
      setData((d) => ({ ...d, [table]: (d[table] as { id: string }[]).map((r) => (r.id === id ? { ...r, ...p } : r)) }));
      return track(backend!.update(table, id, p));
    },
    [backend, track],
  );

  const drop = useCallback(
    (table: Table, id: string) => {
      setData((d) => ({ ...d, [table]: (d[table] as { id: string }[]).filter((r) => r.id !== id) }));
      return track(backend!.remove(table, id));
    },
    [backend, track],
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
    const planned = [...data.planned].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

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
      planned,
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

  /**
   * `planned` links the session to that planned row (otherwise to the Week block the plan came from), and
   * `startedAt` backdates it, for a session caught up from a reminder. Resolves to an error message, or null.
   */
  const beginSession = useCallback(
    async (split: SplitItem<Task>[], opts: { planned?: PlannedSession; startedAt?: string } = {}): Promise<string | null> => {
      if (live) return "Another session is running.";
      if (!split.length) return "Nothing to start: this category has no open tasks.";
      primeAlerts();
      const plannedId = opts.planned?.id ?? plan.plannedId;
      const ts = opts.startedAt ?? nowIso();
      const session: Session = { id: uid(), planned_minutes: split.reduce((a, s) => a + s.minutes, 0), started_at: ts, ended_at: null, pro: null, delta: null };
      const blocks: Block[] = split.map((s, i) => ({
        id: uid(), session_id: session.id, task_id: s.task.id, task_title: s.task.title, category_id: s.task.category_id, position: i,
        planned_minutes: s.minutes, suggested_minutes: s.suggested, spent_seconds: 0,
        started_at: i === 0 ? ts : null, resumed_at: i === 0 ? ts : null, ended_at: null, quick_notes: [],
      }));
      setData((d) => ({ ...d, sessions: [...d.sessions, session], blocks: [...d.blocks, ...blocks] }));
      await track(backend!.insert("sessions", [session]).then(() => backend!.insert("blocks", blocks)));
      if (plannedId) {
        const items = split.map((s) => ({ task_id: s.task.id, task_title: s.task.title, category_id: s.task.category_id, minutes: s.minutes, suggested: s.suggested }));
        void patch("planned", plannedId, { status: opts.startedAt ? "caught_up" : "started", session_id: session.id, plan: items });
      }
      return null;
    },
    [backend, live, patch, plan.plannedId, track],
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
      // A timer end is stamped at the moment it hit 0, not when a throttled check noticed, so overtime counts from there.
      const endedAt = reason === "timer" && b.resumed_at ? new Date(Date.parse(b.resumed_at) + (planned - b.spent_seconds) * 1000).toISOString() : nowIso();
      void patch("blocks", b.id, { spent_seconds: spent, resumed_at: null, ended_at: endedAt });
      if (reason === "timer") {
        chime();
        notify("Time to put this down.", `${b.task_title} — write a pro or delta before you switch.`, `cadence-block-end-${b.id}`);
      }
    },
    [live, patch],
  );

  // Hard stop: schedule the block end at the wall-clock moment the timer reaches 0.
  const endRef = useRef(endBlock);
  const reloadRef = useRef(reload);
  useEffect(() => {
    endRef.current = endBlock;
    reloadRef.current = reload;
  }, [endBlock, reload]);
  const verifiedRef = useRef("");
  const runningBlock = live && live.phase === "run" && live.block.resumed_at ? live.block : null;
  useEffect(() => {
    if (!runningBlock) return;
    const remainingMs = () => (runningBlock.planned_minutes * 60 - elapsedSeconds(runningBlock)) * 1000;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      clearTimeout(timer);
      const ms = remainingMs();
      if (ms > 0) {
        timer = setTimeout(check, Math.min(ms, 30_000)); // re-check; background tabs throttle timers
        return;
      }
      // Another window may have paused or ended this block since we loaded it, so refresh once before stopping it.
      // A changed block re-runs this effect (cancelling this one); an unchanged one is ended on the next check.
      const sig = `${runningBlock.id}:${runningBlock.resumed_at}:${runningBlock.spent_seconds}`;
      if (verifiedRef.current === sig) endRef.current("timer");
      else {
        verifiedRef.current = sig;
        void reloadRef.current().finally(check);
      }
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
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

  /** Save the block-end note and any extra time worked, then start the next block or end the session. Returns the session id when it ends. */
  const finishBlock = useCallback(
    (pro: string, delta: string, extraSeconds = 0): string | null => {
      if (!live || live.phase !== "switch") return null;
      const b = live.block;
      if (extraSeconds > 0) void patch("blocks", b.id, { spent_seconds: b.spent_seconds + Math.round(extraSeconds) });
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
      setPlan({ selected: [], length: null, overrides: {}, order: [] }); // also drops plannedId
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

  const updateDaySettings = useCallback(
    (s: DaySettings) => {
      const next = { ...s, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || s.timezone };
      setDaySettings(next);
      return backend?.saveDaySettings(next).catch(fail);
    },
    [backend, fail],
  );

  // ---------- week timeblocks ----------

  const addPlanned = useCallback(
    (input: Pick<PlannedSession, "category_id" | "starts_at" | "ends_at"> & Partial<PlannedSession>) => {
      const p: PlannedSession = {
        id: uid(), label: "", until_label: "", plan: [], status: "planned", session_id: null, skip_reason: null, created_at: nowIso(), ...input,
      };
      void add("planned", [p]);
      return p;
    },
    [add],
  );

  /** Open the Plan page set up for a timeblock: its category's most pressing tasks, sized to the time left. */
  // A Week block's tasks until it starts: its category's top open ones, 1–4 of them by length.
  const blockTasks = useCallback(
    (p: PlannedSession, minutes: number) =>
      data.tasks
        .filter((t) => !t.done_at && t.category_id === p.category_id)
        .sort(byDueThenPriority)
        .slice(0, Math.min(4, Math.max(1, Math.floor(minutes / 35)))),
    [data.tasks],
  );

  const planFromBlock = useCallback(
    (p: PlannedSession) => {
      const minutes = minutesLeft(p);
      setPlan({ selected: blockTasks(p, minutes).map((t) => t.id), length: minutes, overrides: {}, order: [], plannedId: p.id });
    },
    [blockTasks],
  );

  /** What a planned session starts with, for the reminder pages: its saved plan, else its block's tasks fitted to the minutes left. */
  const splitFor = useCallback(
    (p: PlannedSession, now = Date.now()): SplitItem<Task>[] => {
      if (p.plan.length) {
        return p.plan.flatMap((i) => {
          const t = derived.task(i.task_id);
          return t ? [{ task: t, score: 0, reason: "", suggested: i.suggested, minutes: i.minutes }] : [];
        });
      }
      const minutes = minutesLeft(p, now);
      const last = derived.lastSession;
      return computeSplit(blockTasks(p, minutes), minutes, {
        lastSession: last ? { planned_minutes: last.planned_minutes, alloc: derived.lastAlloc } : null,
        daysSinceTouched: derived.daysSinceTouched,
      });
    },
    [derived, blockTasks],
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
    daySettings,
    updateDaySettings,
    setCategoryGoal: (id: string, minutes: number | null) => void patch("categories", id, { weekly_goal_minutes: minutes }),
    addPlanned,
    updatePlanned: (id: string, p: Partial<PlannedSession>) => void patch("planned", id, p),
    removePlanned: (id: string) => void drop("planned", id),
    planFromBlock,
    splitFor,
  };
}

export type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children, poll }: { children: ReactNode } & StoreOptions) {
  const value = useStoreValue({ poll });
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
