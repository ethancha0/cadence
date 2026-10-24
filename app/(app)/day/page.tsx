"use client";

import { ArrowRight, CalendarDays, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { TaskPicker } from "@/components/TaskPicker";
import { useCalendar } from "@/lib/calendar";
import {
  clockTime, dayBounds, displayStatus, freeWindows, holdsTime, lenLabel, PLANNED_TITLE, sameDay, timeRange, windowKey, windowLabel, type FreeWindow,
} from "@/lib/day";
import { byDueThenPriority, longDate, pad2, startOfDay } from "@/lib/format";
import { computeSplit, type SplitItem } from "@/lib/split";
import { planSplit, useNow, useStore } from "@/lib/store";
import type { CalEvent, PlannedSession, PlannedStatus, PlanItem, Task } from "@/lib/types";

const HOUR_PX = 46;
const MIN = 6e4;
const px = (ms: number) => (ms / MIN) * (HOUR_PX / 60);

const STATUS_WORD: Record<PlannedStatus, string> = { planned: "", started: "started", caught_up: "caught up", skipped: "skipped", missed: "missed" };

type Selection = { kind: "free"; key: string } | { kind: "planned"; id: string };

export default function DayPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Day />
    </Suspense>
  );
}

function Day() {
  const { ready, mode, data, daySettings: ds } = useStore();
  const params = useSearchParams();
  const nowMs = useNow(true, 30_000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const today = useMemo(() => startOfDay(now), [now]);
  const cal = useCalendar(today, ds, mode);
  const [sel, setSel] = useState<Selection | null>(() => {
    const id = params.get("planned");
    return id ? { kind: "planned", id } : null;
  });

  const planned = useMemo(
    () => data.planned.filter((p) => sameDay(p.starts_at, today)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [data.planned, today],
  );
  const timed = useMemo(() => cal.events.filter((e) => !e.allDay), [cal.events]);
  const allDay = useMemo(() => cal.events.filter((e) => e.allDay), [cal.events]);
  const windows = useMemo(
    () =>
      freeWindows(timed, planned, {
        date: today, dayStart: ds.day_start, windDown: ds.wind_down, bufferMinutes: ds.buffer_minutes, minMinutes: ds.min_window_minutes, now,
      }),
    [timed, planned, today, ds, now],
  );

  if (!ready) return <p className="text-muted">Loading…</p>;

  // Default to the first free window; drop a selection that no longer exists.
  const selWindow = sel?.kind === "free" ? windows.find((w) => windowKey(w) === sel.key) : undefined;
  const selPlanned = sel?.kind === "planned" ? planned.find((p) => p.id === sel.id) ?? data.planned.find((p) => p.id === sel.id) : undefined;
  const fallback = !selWindow && !selPlanned ? windows[0] : undefined;
  const activeWindow = selWindow ?? fallback;

  const kept = planned.filter(holdsTime);
  const keptMinutes = kept.reduce((a, p) => a + (Date.parse(p.ends_at) - Date.parse(p.starts_at)) / MIN, 0);

  return (
    <>
      <header className="page-header">
        <span className="card-kicker">{longDate(now)}</span>
        <h1 className="page-title">Plan your day</h1>
        <p className="text-muted page-sub">
          Your calendar sits under your day. Pick a free window and Cadence fits a session into it, with a hard stop before whatever comes next.
        </p>
      </header>

      <div className="day-wrap">
        <section aria-label="Today" className="day-rail-col">
          <RailHeader cal={cal} calendarsConfigured={mode === "local" || ds.calendars.length > 0} mode={mode} now={nowMs} />
          {allDay.length > 0 && (
            <div className="allday-chips" aria-label="All-day events">
              {allDay.map((e) => (
                <span key={e.id} className="tag tag-neutral">
                  {e.title}
                </span>
              ))}
            </div>
          )}
          <Rail
            date={today}
            now={now}
            events={timed}
            windows={windows}
            planned={planned}
            selected={selPlanned ? { kind: "planned", id: selPlanned.id } : activeWindow ? { kind: "free", key: windowKey(activeWindow) } : null}
            onSelect={setSel}
          />
        </section>

        <section aria-label="Session window" className="day-panel">
          {selPlanned ? (
            <PlannedPanel key={selPlanned.id} p={selPlanned} now={now} onRemoved={() => setSel(null)} />
          ) : activeWindow ? (
            <WindowPanel
              key={windowKey(activeWindow)}
              w={activeWindow}
              now={now}
              planned={planned}
              onSaved={(p) => setSel({ kind: "planned", id: p.id })}
            />
          ) : (
            <div className="stack-sm">
              <span className="card-kicker">Session window</span>
              <h2 className="window-range">No free windows left today</h2>
              <p className="text-muted" style={{ margin: 0 }}>
                Nothing of at least {ds.min_window_minutes} minutes before your {clockTime(dayBounds(today, ds.day_start, ds.wind_down).end)} wind-down. You can
                still <Link href="/">plan a session</Link> of any length.
              </p>
            </div>
          )}
          <p className="text-muted xsmall" style={{ margin: 0 }}>
            Today so far: {kept.length} window{kept.length === 1 ? "" : "s"} planned{kept.length ? ` · ${lenLabel(keptMinutes)}` : ""}
          </p>
        </section>
      </div>
    </>
  );
}

// ---------- rail ----------

function RailHeader({
  cal, calendarsConfigured, mode, now,
}: {
  cal: ReturnType<typeof useCalendar>;
  calendarsConfigured: boolean;
  mode: "local" | "supabase";
  now: number;
}) {
  const ago = cal.fetchedAt == null ? null : Math.floor((now - cal.fetchedAt) / MIN);
  const failing = cal.calendars.filter((c) => !c.ok);
  return (
    <>
      <div className="rail-head">
        <h6>Today</h6>
        <span className="rail-source">
          <CalendarDays size={13} aria-hidden="true" />
          {mode === "local" ? "Demo calendar" : `Google Calendar · ${cal.calendars.length} calendar${cal.calendars.length === 1 ? "" : "s"}`}
          {cal.loading ? " · updating…" : ago != null && calendarsConfigured ? ` · updated ${ago < 1 ? "just now" : `${ago} min ago`}` : ""}
        </span>
      </div>
      <p className="text-muted xsmall" style={{ margin: "0 0 var(--space-3)" }}>
        Grey is your calendar. Dashed is free. Click a window to plan it.
      </p>
      {!calendarsConfigured && (
        <p className="text-muted xsmall rail-note">
          No calendars yet. <Link href="/settings">Add your Google Calendar in Settings</Link> to see your events here.
        </p>
      )}
      {cal.error && <p className="text-muted xsmall rail-note">{cal.error}</p>}
      {failing.map((c) => (
        <p key={c.name} className="text-muted xsmall rail-note">
          Couldn&apos;t load {c.name}: {c.error ?? "unknown error"}
        </p>
      ))}
    </>
  );
}

/** Overlapping events share the width: greedy lanes within each overlapping cluster. */
function lanes(events: { start: number; end: number }[]): { lane: number; of: number }[] {
  const order = events.map((e, i) => i).sort((a, b) => events[a].start - events[b].start);
  const out: { lane: number; of: number }[] = new Array(events.length);
  let cluster: number[] = [], laneEnds: number[] = [], clusterEnd = -Infinity;
  const close = () => cluster.forEach((i) => (out[i].of = laneEnds.length));
  for (const i of order) {
    const e = events[i];
    if (e.start >= clusterEnd) {
      close();
      cluster = [];
      laneEnds = [];
    }
    let lane = laneEnds.findIndex((end) => end <= e.start);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = e.end;
    out[i] = { lane, of: 1 };
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  close();
  return out;
}

function Rail({
  date, now, events, windows, planned, selected, onSelect,
}: {
  date: Date;
  now: Date;
  events: CalEvent[];
  windows: FreeWindow[];
  planned: PlannedSession[];
  selected: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const { daySettings: ds } = useStore();
  const { start: S, end: W } = dayBounds(date, ds.day_start, ds.wind_down);
  const s0 = S.getTime(), w0 = W.getTime();
  const y = (t: number) => px(Math.min(Math.max(t, s0), w0) - s0);
  const railH = px(w0 - s0);

  const hours: { t: number; label: string }[] = [];
  const h = new Date(S);
  h.setMinutes(0, 0, 0);
  if (h < S) h.setHours(h.getHours() + 1);
  while (h.getTime() <= w0 + 60 * MIN) {
    hours.push({ t: h.getTime(), label: h.toLocaleTimeString("en-US", { hour: "numeric" }) });
    h.setHours(h.getHours() + 1);
  }

  const shown = events
    .map((e) => ({ e, start: Date.parse(e.start), end: Date.parse(e.end) }))
    .filter((x) => x.start < w0 && x.end > s0);
  const laneOf = lanes(shown);
  const nowT = now.getTime();

  return (
    <div className="rail" style={{ height: railH + HOUR_PX + 8 }}>
      {hours.map((x) => (
        <div key={x.t} aria-hidden="true">
          <div className="rail-hour" style={{ top: px(x.t - s0) - 8 }}>
            {x.label}
          </div>
          <div className="rail-line" style={{ top: px(x.t - s0) }} />
        </div>
      ))}
      <div className="rail-track" style={{ height: railH }}>
        {shown.map(({ e, start, end }, i) => {
          const top = y(start), height = Math.max(14, y(end) - top - 2);
          const { lane, of } = laneOf[i];
          const tall = height >= 40;
          return (
            <div
              key={e.id}
              className={`rail-event${tall ? "" : " short"}`}
              style={{ top: top + 1, height, left: `${(lane / of) * 100}%`, width: `calc(${100 / of}% - ${of > 1 ? 2 : 0}px)` }}
              title={`${e.title} · ${timeRange(e.start, e.end)}${e.calendar ? ` · ${e.calendar}` : ""}`}
            >
              <span className="rail-event-title">{e.title}</span>
              <span className="rail-event-time">{tall ? `${timeRange(e.start, e.end)}${e.calendar ? ` · ${e.calendar}` : ""}` : clockTime(e.start).replace(/\s?[AP]M$/, "")}</span>
            </div>
          );
        })}

        {windows.map((w) => {
          const key = windowKey(w);
          const on = selected?.kind === "free" && selected.key === key;
          const top = y(w.start.getTime()), height = Math.max(22, y(w.end.getTime()) - top - 2);
          return (
            <button
              key={key}
              type="button"
              className="rail-free"
              aria-pressed={on}
              onClick={() => onSelect({ kind: "free", key })}
              style={{ top: top + 1, height }}
            >
              <span className="rail-slot-head">{`+ Free · ${lenLabel(w.minutes)}`}</span>
              {height >= 34 && <span className="rail-slot-range">{timeRange(w.start, w.end)}</span>}
            </button>
          );
        })}

        {planned.map((p) => {
          const status = displayStatus(p, now);
          const dead = status === "skipped" || status === "missed";
          const on = selected?.kind === "planned" && selected.id === p.id;
          const top = y(Date.parse(p.starts_at)), height = Math.max(22, y(Date.parse(p.ends_at)) - top - 2);
          const minutes = (Date.parse(p.ends_at) - Date.parse(p.starts_at)) / MIN;
          return (
            <button
              key={p.id}
              type="button"
              className={`rail-planned${dead ? " dead" : ""}`}
              aria-pressed={on}
              onClick={() => onSelect({ kind: "planned", id: p.id })}
              style={{ top: top + 1, height }}
            >
              <span className="rail-slot-head">
                {dead ? STATUS_WORD[status][0].toUpperCase() + STATUS_WORD[status].slice(1) : `Session · ${lenLabel(minutes)}`}
                {!dead && STATUS_WORD[status] ? ` · ${STATUS_WORD[status]}` : ""}
              </span>
              {height >= 34 && <span className="rail-slot-range">{timeRange(p.starts_at, p.ends_at)}</span>}
            </button>
          );
        })}

        {nowT > s0 && <div className="rail-past" aria-hidden="true" style={{ height: y(nowT) }} />}
        {nowT >= s0 && nowT <= w0 && (
          <div className="rail-now" aria-hidden="true" style={{ top: y(nowT) }}>
            <span />
          </div>
        )}
      </div>
      <div className="rail-winddown" style={{ top: railH + 2, height: HOUR_PX - 4 }}>
        Wind-down · no sessions after {clockTime(W)}
      </div>
    </div>
  );
}

// ---------- panels ----------

/** Open tasks in active categories, by due date then priority. */
function useOpenTasks() {
  const { data, cat } = useStore();
  return useMemo(
    () => data.tasks.filter((t) => !t.done_at && cat(t.category_id) && !cat(t.category_id)!.archived).sort(byDueThenPriority),
    [data.tasks, cat],
  );
}

interface Draft {
  ids: string[];
  overrides: Record<string, number>;
}

/** Split for `minutes` over the draft's tasks, in suggested (score) order. */
function useDraftSplit(draft: Draft, minutes: number, openTasks: Task[]) {
  const { splitCtx } = useStore();
  return useMemo(() => {
    const chosen = draft.ids.map((id) => openTasks.find((t) => t.id === id)).filter((t): t is Task => Boolean(t));
    return computeSplit(chosen, minutes, splitCtx, draft.overrides);
  }, [draft, minutes, openTasks, splitCtx]);
}

const toPlan = (split: SplitItem<Task>[]): PlanItem[] =>
  split.map((s) => ({ task_id: s.task.id, task_title: s.task.title, category_id: s.task.category_id, minutes: s.minutes, suggested: s.suggested }));

function WindowHead({ kicker, range, why, minutes, blocks, stop }: { kicker: string; range: string; why: string; minutes: number; blocks: number; stop: string }) {
  return (
    <>
      <div className="stack-sm">
        <span className="card-kicker">{kicker}</span>
        <h2 className="window-range">{range}</h2>
        <p className="text-muted" style={{ margin: 0, maxWidth: "56ch" }}>
          {why}
        </p>
      </div>
      <div className="tags">
        <span className="tag tag-accent">{lenLabel(minutes)} of focus</span>
        <span className="tag tag-neutral">
          {blocks} block{blocks === 1 ? "" : "s"}
        </span>
        <span className="tag tag-neutral">Hard stop {stop}</span>
      </div>
    </>
  );
}

/** Split bar plus one row per block, with optional ± minute steppers. */
function SplitList({ items, onBump }: { items: { key: string; title: string; category_id: string; minutes: number }[]; onBump?: (key: string, minutes: number, d: number) => void }) {
  const { catName } = useStore();
  if (!items.length) return <p className="text-muted empty-line">No tasks in this session yet. Use Change tasks to pick some.</p>;
  return (
    <>
      <div className="split-bar">
        {items.map((s, i) => (
          <div key={s.key} className="split-seg" style={{ flex: `${s.minutes} 1 0`, background: i % 2 ? "var(--color-accent-100)" : "var(--color-accent-200)" }}>
            {s.title}
          </div>
        ))}
      </div>
      {items.map((s, i) => (
        <div key={s.key} className="day-split-row">
          <span className="order-num">{pad2(i + 1)}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span className="split-title">{s.title}</span>
            <span>
              <span className="tag tag-neutral">{catName(s.category_id)}</span>
            </span>
          </div>
          {onBump ? (
            <div className="stepper">
              <button className="btn btn-secondary btn-icon" onClick={() => onBump(s.key, s.minutes, -5)} aria-label={`Less time for ${s.title}`}>
                <Minus size={14} />
              </button>
              <span className="mins">
                {s.minutes}
                <small> min</small>
              </span>
              <button className="btn btn-secondary btn-icon" onClick={() => onBump(s.key, s.minutes, 5)} aria-label={`More time for ${s.title}`}>
                <Plus size={14} />
              </button>
            </div>
          ) : (
            <span className="mins">
              {s.minutes}
              <small> min</small>
            </span>
          )}
        </div>
      ))}
    </>
  );
}

/** Split editor shared by a free window and a saved session's Edit tasks. */
function SplitEditor({ draft, setDraft, split, picking, setPicking }: {
  draft: Draft;
  setDraft: (f: (d: Draft) => Draft) => void;
  split: SplitItem<Task>[];
  picking: boolean;
  setPicking: (b: boolean) => void;
}) {
  const openTasks = useOpenTasks();
  const toggle = (id: string) =>
    setDraft((d) => ({ overrides: {}, ids: d.ids.includes(id) ? d.ids.filter((x) => x !== id) : [...d.ids, id] }));
  return (
    <div>
      <div className="section-head">
        <h6>Suggested split</h6>
        <span className="btn-row">
          {Object.keys(draft.overrides).length > 0 && (
            <button className="btn btn-ghost" onClick={() => setDraft((d) => ({ ...d, overrides: {} }))}>
              Reset times
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            {picking ? "Done" : "Change tasks"}
          </button>
        </span>
      </div>
      {picking && (
        <div className="day-picker">
          <TaskPicker tasks={openTasks} selected={draft.ids} onToggle={toggle} />
        </div>
      )}
      <SplitList
        items={split.map((s) => ({ key: s.task.id, title: s.task.title, category_id: s.task.category_id, minutes: s.minutes }))}
        onBump={(id, cur, d) => setDraft((x) => ({ ...x, overrides: { ...x.overrides, [id]: Math.max(5, cur + d) } }))}
      />
    </div>
  );
}

function RemindBox({ checked, onChange }: { checked: boolean; onChange: (b: boolean) => void }) {
  const { daySettings: ds, mode } = useStore();
  if (mode !== "supabase" || !ds.discord_webhook_url) return null;
  return (
    <label className="check-line boxed">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Remind me on Discord
        <br />
        <span className="text-muted">5 minutes before, at the start, and a ping 10 minutes in if nothing&apos;s running.</span>
      </span>
    </label>
  );
}

function WindowPanel({ w, now, planned, onSaved }: { w: FreeWindow; now: Date; planned: PlannedSession[]; onSaved: (p: PlannedSession) => void }) {
  const { daySettings: ds, addPlanned, beginSession, live, task } = useStore();
  const router = useRouter();
  const openTasks = useOpenTasks();
  const label = windowLabel(w, now);

  // Suggest open tasks not already in another live planned session today.
  const [draft, setDraft] = useState<Draft>(() => {
    const taken = new Set(planned.filter(holdsTime).flatMap((p) => p.plan.map((i) => i.task_id)));
    const count = Math.min(4, Math.max(1, Math.floor(w.minutes / 35)));
    return { ids: openTasks.filter((t) => !taken.has(t.id)).slice(0, count).map((t) => t.id), overrides: {} };
  });
  const [picking, setPicking] = useState(false);
  const [remind, setRemind] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const split = useDraftSplit(draft, w.minutes, openTasks);

  const why = w.until
    ? w.until === PLANNED_TITLE
      ? `Ends before your next planned session${ds.buffer_minutes ? `, with ${ds.buffer_minutes} minutes to spare` : ""}.`
      : `Ends when ${w.until} starts at ${clockTime(w.end.getTime() + ds.buffer_minutes * MIN)}.${ds.buffer_minutes ? ` The hard stop leaves you ${ds.buffer_minutes} minutes.` : ""}`
    : `It ends at your ${clockTime(w.end)} wind-down.`;
  const startsNow = w.start.getTime() - now.getTime() < 15 * MIN;

  const save = async () => {
    setBusy(true);
    const p = await addPlanned({
      starts_at: w.start.toISOString(), ends_at: w.end.toISOString(), label, until_label: w.until === PLANNED_TITLE ? "" : w.until ?? "", plan: toPlan(split), remind,
    });
    setBusy(false);
    return p;
  };

  const startNow = async () => {
    const p = await save();
    const err = await beginSession(planSplit(p, task), { planned: p });
    if (err) {
      setMsg(err);
      onSaved(p);
    } else router.push("/session");
  };

  return (
    <>
      <WindowHead
        kicker={`Session window · ${label}`}
        range={timeRange(w.start, w.end)}
        why={why}
        minutes={w.minutes}
        blocks={split.length}
        stop={clockTime(w.end)}
      />
      <SplitEditor draft={draft} setDraft={setDraft} split={split} picking={picking} setPicking={setPicking} />
      <RemindBox checked={remind} onChange={setRemind} />
      <div className="btn-row" style={{ alignItems: "center" }}>
        <button className="btn btn-primary btn-lg" disabled={busy || !split.length} onClick={async () => onSaved(await save())}>
          Save to my day
          <ArrowRight size={16} />
        </button>
        {startsNow && (
          <button className="btn btn-secondary btn-lg" disabled={busy || !split.length || Boolean(live)} onClick={startNow}>
            Start now instead
          </button>
        )}
      </div>
      {live && startsNow && (
        <p className="text-muted small" style={{ margin: 0 }}>
          A session is already running. <Link href="/session">Go to it</Link>.
        </p>
      )}
      {msg && <p className="small" style={{ color: "var(--color-accent-700)", margin: 0 }}>{msg}</p>}
    </>
  );
}

function PlannedPanel({ p, now, onRemoved }: { p: PlannedSession; now: Date; onRemoved: () => void }) {
  const { daySettings: ds, beginSession, live, task, updatePlanned, removePlanned } = useStore();
  const router = useRouter();
  const openTasks = useOpenTasks();
  const status = displayStatus(p, now);
  const minutes = Math.floor((Date.parse(p.ends_at) - Date.parse(p.starts_at)) / MIN);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => ({
    ids: p.plan.flatMap((i) => (i.task_id ? [i.task_id] : [])),
    overrides: Object.fromEntries(p.plan.flatMap((i) => (i.task_id && i.minutes !== i.suggested ? [[i.task_id, i.minutes]] : []))),
  }));
  const [msg, setMsg] = useState<string | null>(null);
  const split = useDraftSplit(draft, minutes, openTasks);

  const why = p.until_label ? `Ends when ${p.until_label} starts.` : `It ends at your ${clockTime(dayBounds(new Date(p.starts_at), ds.day_start, ds.wind_down).end)} wind-down.`;
  const statusLine: Partial<Record<PlannedStatus, string>> = {
    started: "Started.",
    caught_up: "Logged with catch-up.",
    skipped: `Skipped${p.skip_reason ? `: ${p.skip_reason}` : ""}.`,
    missed: "Missed. The window ended without a session.",
  };

  const start = async () => {
    const err = await beginSession(planSplit(p, task), { planned: p });
    if (err) setMsg(err);
    else router.push("/session");
  };

  return (
    <>
      <WindowHead
        kicker={`Planned session · ${p.label || "Today"}${STATUS_WORD[status] ? ` · ${STATUS_WORD[status]}` : ""}`}
        range={timeRange(p.starts_at, p.ends_at)}
        why={`${why}${statusLine[status] ? ` ${statusLine[status]}` : ""}`}
        minutes={minutes}
        blocks={editing ? split.length : p.plan.length}
        stop={clockTime(p.ends_at)}
      />
      {editing ? (
        <SplitEditor draft={draft} setDraft={setDraft} split={split} picking={picking} setPicking={setPicking} />
      ) : (
        <div>
          <div className="section-head">
            <h6>Plan</h6>
          </div>
          <SplitList items={p.plan.map((i, n) => ({ key: `${n}`, title: task(i.task_id)?.title ?? i.task_title, category_id: i.category_id, minutes: i.minutes }))} />
        </div>
      )}
      {status === "planned" && <RemindBox checked={p.remind} onChange={(b) => void updatePlanned(p.id, { remind: b })} />}
      <div className="btn-row" style={{ alignItems: "center" }}>
        {editing ? (
          <>
            <button
              className="btn btn-primary btn-lg"
              disabled={!split.length}
              onClick={() => {
                void updatePlanned(p.id, { plan: toPlan(split) });
                setEditing(false);
                setPicking(false);
              }}
            >
              Save changes
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : status === "planned" ? (
          <>
            <button className="btn btn-primary btn-lg" onClick={start} disabled={Boolean(live) || !p.plan.length}>
              Start now
              <ArrowRight size={16} />
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => setEditing(true)}>
              Edit tasks
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                removePlanned(p.id);
                onRemoved();
              }}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            {live && live.session.id === p.session_id ? (
              <Link className="btn btn-primary btn-lg" href="/session">
                Go to the session
                <ArrowRight size={16} />
              </Link>
            ) : (
              p.session_id && (
                <Link className="btn btn-secondary btn-lg" href={`/summary/${p.session_id}`}>
                  See the summary
                </Link>
              )
            )}
            {(status === "skipped" || status === "missed") && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  removePlanned(p.id);
                  onRemoved();
                }}
              >
                Remove
              </button>
            )}
          </>
        )}
      </div>
      {live && status === "planned" && !editing && (
        <p className="text-muted small" style={{ margin: 0 }}>
          A session is already running. <Link href="/session">Go to it</Link>.
        </p>
      )}
      {msg && <p className="small" style={{ color: "var(--color-accent-700)", margin: 0 }}>{msg}</p>}
    </>
  );
}
