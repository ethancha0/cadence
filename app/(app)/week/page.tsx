"use client";

import { ArrowLeft, ArrowRight, Play, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { timeToHours } from "@/lib/calendar";
import { startOfWeek } from "@/lib/format";
import { minutesLeft, useNow, useStore } from "@/lib/store";
import type { CalColor, PlannedSession } from "@/lib/types";
import { useCalendar } from "@/lib/useCalendar";
import { addDays, atHour, firstFreeSlot, hm, hourLabel, hourRange, overlaps, snap, toSlot, weekFromParam, weekParam, type Span } from "@/lib/week";

const HOUR_PX = 40;
const GUTTER = 48;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Drag =
  | { mode: "move"; id: string; grab: number; span: Span; x0: number; y0: number; moved: boolean }
  | { mode: "resize"; id: string; span: Span; x0: number; y0: number; moved: boolean }
  | { mode: "new"; categoryId: string; hours: number; x0: number; y0: number; moved: boolean };

interface GridEvent extends Span {
  id: string;
  title: string;
  color: CalColor;
}

interface GridBlock extends Span {
  p: PlannedSession;
  label: string;
  locked: boolean;
  missed: boolean;
}

const calVars = (c: CalColor) => ({ background: `var(--cal-${c}-bg)`, color: `var(--cal-${c}-fg)` });

export default function WeekPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Week />
    </Suspense>
  );
}

function Week() {
  const store = useStore();
  const { ready, mode, daySettings, planned, activeCategories, catName, addPlanned, updatePlanned, removePlanned, planFromBlock, live } = store;
  const router = useRouter();
  const params = useSearchParams();
  const wParam = params.get("w");
  const monday = useMemo(() => weekFromParam(wParam), [wParam]);
  const sunday = useMemo(() => addDays(monday, 7), [monday]);
  const nowMs = useNow(true, 60_000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const dayStart = Math.floor(timeToHours(daySettings.day_start));
  const dayEnd = Math.max(dayStart + 1, Math.min(24, Math.ceil(timeToHours(daySettings.wind_down))));
  const gridH = (dayEnd - dayStart) * HOUR_PX;

  const cal = useCalendar(mode, daySettings.calendars, monday, sunday);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const colorOf = useMemo(() => new Map(cal.feeds.map((f) => [f.id, f.color])), [cal.feeds]);

  // ---------- events and blocks, as spans on the grid ----------

  const { events, allDay } = useMemo(() => {
    const events: GridEvent[] = [];
    const allDay: { day: number; title: string; color: CalColor; id: string }[] = [];
    for (const e of cal.events) {
      if (hidden[e.calendar]) continue;
      const color = colorOf.get(e.calendar) ?? "stone";
      if (e.allDay) {
        // start/end are YYYY-MM-DD, end exclusive
        for (let d = 0; d < 7; d++) {
          const iso = weekParam(addDays(monday, d));
          if (e.start <= iso && iso < e.end) allDay.push({ id: e.id + d, day: d, title: e.title, color });
        }
        continue;
      }
      const s = new Date(e.start), en = new Date(e.end);
      const a = toSlot(monday, s), b = toSlot(monday, en);
      for (let d = Math.max(0, a.day); d <= Math.min(6, b.day); d++) {
        const start = Math.max(dayStart, d === a.day ? a.hour : 0);
        const end = Math.min(dayEnd, d === b.day ? b.hour : 24);
        if (end > start) events.push({ id: e.id + ":" + d, day: d, start, end, title: e.title, color });
      }
    }
    return { events, allDay };
  }, [cal.events, hidden, colorOf, monday, dayStart, dayEnd]);

  const weekPlanned = useMemo(
    () => planned.filter((p) => p.category_id && Date.parse(p.starts_at) < sunday.getTime() && Date.parse(p.ends_at) > monday.getTime()),
    [planned, monday, sunday],
  );

  const blocks = useMemo<GridBlock[]>(
    () =>
      weekPlanned.map((p) => {
        const a = toSlot(monday, new Date(p.starts_at));
        const b = toSlot(monday, new Date(p.ends_at));
        const ended = Date.parse(p.ends_at) <= nowMs;
        return {
          p,
          day: a.day,
          start: a.hour,
          end: b.day === a.day ? b.hour : 24,
          label: catName(p.category_id!),
          locked: p.status !== "planned" || ended,
          missed: p.status === "missed" || (p.status === "planned" && ended),
        };
      }),
    [weekPlanned, monday, nowMs, catName],
  );

  // ---------- selection & drag ----------

  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; span: Span } | null>(null);
  const [ghost, setGhost] = useState<{ categoryId: string; span: Span; valid: boolean } | null>(null);
  const draftRef = useRef(draft);
  const ghostRef = useRef(ghost);
  const dragRef = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    draftRef.current = draft;
    ghostRef.current = ghost;
  }, [draft, ghost]);

  const spanOf = (b: GridBlock): Span => (draft && draft.id === b.p.id ? draft.span : b);
  const startsInPast = useCallback((s: Span) => atHour(monday, s.day, s.start).getTime() < nowMs, [monday, nowMs]);
  const clampStart = (s: number, dur: number) => Math.max(dayStart, Math.min(dayEnd - dur, s));

  const geom = useCallback(
    (x: number, y: number) => {
      const el = gridRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
      const gx = x - r.left - GUTTER * scale;
      const colW = (r.width - GUTTER * scale) / 7;
      return {
        inside: gx >= 0 && gx <= r.width - GUTTER * scale && y >= r.top && y <= r.bottom,
        day: Math.max(0, Math.min(6, Math.floor(gx / colW))),
        hour: dayStart + ((y - r.top) / r.height) * (dayEnd - dayStart),
      };
    },
    [dayStart, dayEnd],
  );

  const commit = useCallback(
    (id: string, s: Span) => {
      if (startsInPast(s)) return;
      updatePlanned(id, { starts_at: atHour(monday, s.day, s.start).toISOString(), ends_at: atHour(monday, s.day, s.end).toISOString() });
    },
    [monday, startsInPast, updatePlanned],
  );

  const create = useCallback(
    (categoryId: string, s: Span) => {
      const p = addPlanned({
        category_id: categoryId,
        label: catName(categoryId),
        starts_at: atHour(monday, s.day, s.start).toISOString(),
        ends_at: atHour(monday, s.day, s.end).toISOString(),
      });
      setSel(p.id);
    },
    [addPlanned, catName, monday],
  );

  const onMove = useCallback(
    (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 4) return;
      d.moved = true;
      const g = geom(ev.clientX, ev.clientY);
      if (!g) return;
      if (d.mode === "new") {
        if (!g.inside) return setGhost(null);
        const start = clampStart(snap(g.hour - d.hours / 2), d.hours);
        const span = { day: g.day, start, end: start + d.hours };
        setGhost({ categoryId: d.categoryId, span, valid: !startsInPast(span) });
      } else if (d.mode === "move") {
        const dur = d.span.end - d.span.start;
        const start = clampStart(snap(g.hour - d.grab), dur);
        setDraft({ id: d.id, span: { day: g.day, start, end: start + dur } });
      } else {
        const end = Math.min(dayEnd, Math.max(d.span.start + 0.5, snap(g.hour)));
        setDraft({ id: d.id, span: { ...d.span, end } });
      }
    },
    // clampStart only reads dayStart/dayEnd
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geom, dayEnd, dayStart, startsInPast],
  );

  const onUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved) {
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
    }
    const dr = draftRef.current, gh = ghostRef.current;
    if (d.mode === "new" && gh?.valid) create(gh.categoryId, gh.span);
    if (d.mode !== "new" && dr && d.moved) commit(dr.id, dr.span);
    setDraft(null);
    setGhost(null);
  }, [commit, create]);

  const follow = (d: Drag) => {
    dragRef.current = d;
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const startDrag = (e: ReactPointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    follow(d);
  };

  // On touch a category only drags after a still press, so a swipe that starts on one scrolls the page.
  const [holding, setHolding] = useState<string | null>(null);
  const holdToDrag = (e: ReactPointerEvent, d: Drag & { mode: "new" }) => {
    const pid = e.pointerId;
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === pid && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 8) stop();
    };
    const timer = window.setTimeout(() => {
      stop();
      // a press that turned into a drag isn't also a tap
      justDragged.current = true;
      setHolding(d.categoryId);
      follow(d);
    }, 350);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  // Once a held drag is live, keep the finger from scrolling the page. Registered up front and non-passive,
  // since browsers only let a touchmove listener cancel scrolling if it was there when the touch began.
  const paletteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = paletteRef.current;
    if (!el) return;
    const block = (ev: TouchEvent) => dragRef.current && ev.preventDefault();
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, [ready]);
  useEffect(() => {
    if (!holding) return;
    const end = () => {
      setHolding(null);
      setTimeout(() => (justDragged.current = false), 0);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [holding]);

  const busy = useCallback(
    (exceptId?: string): Span[] => [...events, ...blocks.filter((b) => b.p.id !== exceptId && !b.missed)],
    [events, blocks],
  );
  const overTitles = (s: Span, exceptId: string) => [
    ...events.filter((e) => overlaps(s, e)).map((e) => e.title),
    ...blocks.filter((b) => b.p.id !== exceptId && overlaps(s, b)).map((b) => `${b.label} block`),
  ];

  const keyFor = (b: GridBlock) => (e: KeyboardEvent) => {
    if (b.locked) return;
    const dur = b.end - b.start;
    let s: Span | null = null;
    if (e.key === "ArrowUp") s = e.shiftKey ? { ...b, end: Math.max(b.start + 0.5, b.end - 0.25) } : { day: b.day, start: clampStart(b.start - 0.25, dur), end: clampStart(b.start - 0.25, dur) + dur };
    else if (e.key === "ArrowDown") s = e.shiftKey ? { ...b, end: Math.min(dayEnd, b.end + 0.25) } : { day: b.day, start: clampStart(b.start + 0.25, dur), end: clampStart(b.start + 0.25, dur) + dur };
    else if (e.key === "ArrowLeft") s = { ...b, day: Math.max(0, b.day - 1) };
    else if (e.key === "ArrowRight") s = { ...b, day: Math.min(6, b.day + 1) };
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removePlanned(b.p.id);
      setSel(null);
      return;
    }
    if (s) {
      e.preventDefault();
      // a block moved to another day remounts in that column, so focus has to follow it there
      if (s.day !== b.day) refocus.current = { id: b.p.id, day: s.day };
      commit(b.p.id, { day: s.day, start: s.start, end: s.end });
    }
  };
  const refocus = useRef<{ id: string; day: number } | null>(null);
  useEffect(() => {
    const r = refocus.current;
    if (!r || !blocks.some((b) => b.p.id === r.id && b.day === r.day)) return;
    refocus.current = null;
    gridRef.current?.querySelector<HTMLElement>(`[data-block="${r.id}"]`)?.focus();
  }, [blocks]);

  // ---------- derived for the sidebar ----------

  const thisWeek = monday.getTime() <= nowMs && nowMs < sunday.getTime();
  const nowSlot = thisWeek ? toSlot(monday, now) : null;
  const weekOver = sunday.getTime() <= nowMs;

  const placed = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of blocks) if (!b.missed && b.p.status !== "skipped") m.set(b.p.category_id!, (m.get(b.p.category_id!) ?? 0) + (b.end - b.start) * 60);
    return m;
  }, [blocks]);
  const totalPlaced = [...placed.values()].reduce((a, b) => a + b, 0);
  const totalGoal = activeCategories.reduce((a, c) => a + (c.weekly_goal_minutes ?? 0), 0);

  const autoPlace = (categoryId: string) => {
    if (justDragged.current || weekOver) return;
    const from = nowSlot ? { day: nowSlot.day, hour: nowSlot.hour } : { day: 0, hour: dayStart };
    const slot = firstFreeSlot(busy(), 1, dayStart, dayEnd, from);
    if (slot) create(categoryId, slot);
  };

  const selected = blocks.find((b) => b.p.id === sel) ?? null;
  const selSpan = selected ? spanOf(selected) : null;
  const canStart = Boolean(selected && selected.p.status === "planned" && !live && nowMs >= Date.parse(selected.p.starts_at) - 15 * 6e4 && minutesLeft(selected.p, nowMs) >= 15);

  const go = (w: Date) => router.replace(`/week?w=${weekParam(w)}`, { scroll: false });
  const weekLabel = `${monday.toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${addDays(monday, 6).toLocaleDateString("en-US", { month: monday.getMonth() === addDays(monday, 6).getMonth() ? undefined : "long", day: "numeric" })}`;
  const kicker = thisWeek ? "This week" : monday.getTime() === addDays(startOfWeek(now), 7).getTime() ? "Next week" : "Week of";

  if (!ready) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <div className="week-head">
        <header className="page-header">
          <span className="card-kicker">
            {kicker} · {weekLabel}
          </span>
          <h1 className="page-title">Block out your week</h1>
          <p className="text-muted page-sub">
            Drag a commitment onto the week. Timeblocks are see-through, so you can tell what&apos;s underneath before you drop one.
          </p>
        </header>
        <div className="week-nav">
          <button className="btn btn-secondary btn-icon" onClick={() => go(addDays(monday, -7))} aria-label="Previous week">
            <ArrowLeft size={16} />
          </button>
          <button className="btn btn-secondary" onClick={() => go(startOfWeek(now))} disabled={thisWeek}>
            This week
          </button>
          <button className="btn btn-secondary btn-icon" onClick={() => go(addDays(monday, 7))} aria-label="Next week">
            <ArrowRight size={16} />
          </button>
          <span className="small tnum" style={{ marginLeft: "var(--space-2)" }}>
            Placed {hm(totalPlaced)}
            {totalGoal ? ` of ${hm(totalGoal)}` : ""}
          </span>
        </div>
      </div>

      <div className="week-wrap">
        <aside className="week-side">
          <section>
            <h6>Timeblocks</h6>
            <p className="text-muted xsmall" style={{ marginBottom: "var(--space-2)" }}>
              {weekOver ? "This week is over." : "Drag one onto the week, or press it to drop an hour in the first free slot."}
            </p>
            <div className="palette" ref={paletteRef}>
              {activeCategories.map((c) => {
                const got = placed.get(c.id) ?? 0;
                const goal = c.weekly_goal_minutes ?? 0;
                const short = goal > 0 && got < goal;
                return (
                  <button
                    key={c.id}
                    className={`palette-chip${holding === c.id ? " holding" : ""}`}
                    disabled={weekOver}
                    onPointerDown={(e) => {
                      const d = { mode: "new" as const, categoryId: c.id, hours: 1, x0: e.clientX, y0: e.clientY, moved: false };
                      if (e.pointerType === "touch") holdToDrag(e, d);
                      else startDrag(e, d);
                    }}
                    onClick={() => autoPlace(c.id)}
                    aria-label={`${c.name}: ${hm(got)} placed${goal ? ` of ${hm(goal)}` : ""}. Drag onto the week, or press to add an hour in the first free slot.`}
                  >
                    <span className="palette-top">
                      <svg width="10" height="14" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
                        <circle cx="3" cy="3" r="1.4" /><circle cx="9" cy="3" r="1.4" /><circle cx="3" cy="8" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="3" cy="13" r="1.4" /><circle cx="9" cy="13" r="1.4" />
                      </svg>
                      <span className="palette-name">{c.name}</span>
                      <span className={`palette-fig tnum${short ? " short" : ""}`}>{goal ? `${hm(got)} / ${hm(goal)}` : `${hm(got)}`}</span>
                    </span>
                    {goal > 0 && (
                      <span className={`palette-bar${short ? " short" : ""}`}>
                        <span style={{ width: `${Math.min(100, Math.round((got / goal) * 100))}%` }} />
                      </span>
                    )}
                  </button>
                );
              })}
              {!activeCategories.length && (
                <p className="text-muted small">
                  Add a category on the <Link href="/tasks">Tasks</Link> page first.
                </p>
              )}
            </div>
            <p className="text-muted xsmall" style={{ margin: "var(--space-2) 0 0" }}>
              Weekly goals are set per category on the <Link href="/tasks">Tasks</Link> page.
            </p>
          </section>

          <section className="sel-card" aria-live="polite">
            <span className="card-kicker">Selected</span>
            {selected && selSpan ? (
              <>
                <span className="card-title" style={{ fontSize: 20 }}>
                  {selected.label} · {hm((selSpan.end - selSpan.start) * 60)}
                </span>
                <span className="small">
                  {DAY_NAMES[selSpan.day]}, {hourRange(selSpan.start, selSpan.end)}
                </span>
                {overTitles(selSpan, selected.p.id).length > 0 && <span className="small" style={{ color: "var(--color-accent-700)" }}>Over {overTitles(selSpan, selected.p.id).join(", ")}</span>}
                <span className="text-muted xsmall">
                  {selected.p.status === "started" && "Started."}
                  {selected.missed && "This block passed without a session."}
                  {!selected.locked && "Drag to move, drag the bottom edge to resize. With the block focused: arrows move it, Shift+arrows resize, Delete removes."}
                </span>
                <div className="btn-row" style={{ marginTop: "var(--space-1)" }}>
                  {selected.p.status === "planned" && !selected.missed && (
                    <button
                      className="btn btn-primary"
                      disabled={!canStart}
                      onClick={() => {
                        planFromBlock(selected.p);
                        router.push("/");
                      }}
                      title={canStart ? undefined : live ? "A session is already running" : "Opens 15 minutes before the block starts"}
                    >
                      <Play size={14} />
                      Plan &amp; start
                    </button>
                  )}
                  {!selected.locked && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        removePlanned(selected.p.id);
                        setSel(null);
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </>
            ) : (
              <span className="text-muted small">Nothing selected. Click a timeblock to see it here.</span>
            )}
          </section>

          <section>
            <div className="section-head">
              <h6>Calendars</h6>
              {mode === "supabase" && cal.feeds.length > 0 && (
                <button className="btn btn-ghost" onClick={cal.refresh} aria-label="Refresh calendars">
                  <RotateCw size={13} />
                </button>
              )}
            </div>
            {cal.feeds.map((f) => {
              const st = cal.status.find((s) => s.id === f.id);
              return (
                <div key={f.id}>
                  <label className="cal-toggle">
                    <input type="checkbox" checked={!hidden[f.id]} onChange={() => setHidden((h) => ({ ...h, [f.id]: !h[f.id] }))} style={{ accentColor: `var(--cal-${f.color}-sw)` }} />
                    <span className="cal-swatch" style={{ background: `var(--cal-${f.color}-bg)`, boxShadow: `inset 0 0 0 1.5px var(--cal-${f.color}-sw)` }} />
                    <span>{f.name}</span>
                  </label>
                  {st && !st.ok && <p className="xsmall" style={{ margin: "0 0 4px 26px", color: "var(--color-accent-700)" }}>{st.error}</p>}
                </div>
              );
            })}
            <p className="text-muted xsmall" style={{ margin: "var(--space-2) 0 0" }}>
              {mode === "local" && "Sample calendars (demo mode)."}
              {mode === "supabase" && !cal.feeds.length && (
                <>
                  No calendars yet. <Link href="/settings">Add one in Settings</Link>.
                </>
              )}
              {mode === "supabase" && cal.feeds.length > 0 && (cal.loading ? "Loading…" : cal.error ? cal.error : cal.updatedAt ? `Updated ${updatedAgo(cal.updatedAt, nowMs)}. ` : "")}
              {mode === "supabase" && cal.feeds.length > 0 && <Link href="/settings">Colours and calendars</Link>}
            </p>
          </section>
        </aside>

        <section className="week-main" aria-label="Week calendar">
          <div className="week-scroll">
            <div className="week-inner">
              <div className="week-days">
                <div className="week-gutter" />
                {SHORT.map((name, d) => {
                  const date = addDays(monday, d);
                  return (
                    <div key={d} className={`week-day-head${nowSlot?.day === d ? " today" : ""}`}>
                      <div className="week-day-name">
                        {name} {date.getDate()}
                      </div>
                      {allDay.some((a) => a.day === d) && (
                        <div className="week-allday">
                          {allDay
                            .filter((a) => a.day === d)
                            .map((a) => (
                              <span key={a.id} style={calVars(a.color)} title={a.title}>
                                {a.title}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="week-body" ref={gridRef} style={{ height: gridH }}>
                <div className="week-gutter">
                  {Array.from({ length: dayEnd - dayStart }, (_, i) => (
                    <span key={i} className="week-hour" style={{ top: i * HOUR_PX }}>
                      {hourLabel(dayStart + i)}
                    </span>
                  ))}
                </div>
                {SHORT.map((_, d) => {
                  const pastH = !nowSlot ? (weekOver ? gridH : 0) : d < nowSlot.day ? gridH : d === nowSlot.day ? Math.max(0, Math.min(gridH, (nowSlot.hour - dayStart) * HOUR_PX)) : 0;
                  return (
                    <div key={d} className={`week-col${nowSlot?.day === d ? " today" : ""}`}>
                      {Array.from({ length: dayEnd - dayStart - 1 }, (_, i) => (
                        <div key={i} className="week-line" style={{ top: (i + 1) * HOUR_PX }} />
                      ))}
                      {events
                        .filter((e) => e.day === d)
                        .map((e) => {
                          const h = (e.end - e.start) * HOUR_PX;
                          return (
                            <div key={e.id} className="cal-ev" style={{ ...calVars(e.color), top: (e.start - dayStart) * HOUR_PX + 1, height: h - 2 }} title={`${e.title} · ${hourRange(e.start, e.end)}`}>
                              <b>{e.title}</b>
                              {h >= 44 && hourRange(e.start, e.end)}
                            </div>
                          );
                        })}
                      {pastH > 0 && <div className="week-past" style={{ height: pastH }} />}
                      {nowSlot?.day === d && pastH > 0 && pastH < gridH && <div className="week-now" style={{ top: pastH }} />}
                      {blocks
                        .filter((b) => spanOf(b).day === d)
                        .map((b) => {
                          const s = spanOf(b);
                          const hpx = (s.end - s.start) * HOUR_PX;
                          const over = overTitles(s, b.p.id);
                          const isSel = sel === b.p.id;
                          const dragging = draft?.id === b.p.id;
                          const cls = ["tb", isSel && "selected", dragging && "dragging", dragging && startsInPast(s) && "invalid", b.locked && "locked", b.missed && "missed"].filter(Boolean).join(" ");
                          return (
                            <div key={b.p.id} className={cls} style={{ top: (s.start - dayStart) * HOUR_PX, height: hpx }}>
                              <button
                                className="tb-hit"
                                data-block={b.p.id}
                                aria-label={`${b.label} timeblock, ${DAY_NAMES[s.day]} ${hourRange(s.start, s.end)}${over.length ? `, over ${over.join(", ")}` : ""}.${b.locked ? "" : " Arrow keys move, Shift and arrows resize, Delete removes."}`}
                                onPointerDown={(e) => {
                                  setSel(b.p.id);
                                  if (b.locked) return;
                                  const g = geom(e.clientX, e.clientY);
                                  startDrag(e, { mode: "move", id: b.p.id, grab: g ? g.hour - b.start : 0, span: b, x0: e.clientX, y0: e.clientY, moved: false });
                                }}
                                onClick={() => !justDragged.current && setSel(b.p.id)}
                                onKeyDown={keyFor(b)}
                              />
                              <div className="tb-label">
                                <b>
                                  {b.label} · {hm((s.end - s.start) * 60)}
                                </b>
                                {hpx >= 50 && <div>{hourRange(s.start, s.end)}</div>}
                                {hpx >= 66 && over.length > 0 && <div className="over">over {over.join(", ")}</div>}
                                {hpx >= 50 && b.locked && <div>{b.missed ? "Missed" : "Started"}</div>}
                              </div>
                              {isSel && !b.locked && !dragging && (
                                <>
                                  <button
                                    className="tb-x"
                                    aria-label="Remove timeblock"
                                    onClick={() => {
                                      removePlanned(b.p.id);
                                      setSel(null);
                                    }}
                                  >
                                    <X size={11} strokeWidth={3} />
                                  </button>
                                  <button
                                    className="tb-resize"
                                    aria-label="Resize timeblock"
                                    onPointerDown={(e) => startDrag(e, { mode: "resize", id: b.p.id, span: b, x0: e.clientX, y0: e.clientY, moved: false })}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}
                      {ghost?.span.day === d && (
                        <div className={`tb ghost${ghost.valid ? "" : " invalid"}`} style={{ top: (ghost.span.start - dayStart) * HOUR_PX, height: (ghost.span.end - ghost.span.start) * HOUR_PX }}>
                          <div className="tb-label">
                            <b>
                              {catName(ghost.categoryId)} · {hm((ghost.span.end - ghost.span.start) * 60)}
                            </b>
                            <div>{ghost.valid ? hourRange(ghost.span.start, ghost.span.end) : "That time has passed"}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="text-muted xsmall" style={{ marginTop: "var(--space-2)" }}>
            Changes save as you go. When a block comes up, select it and press Plan &amp; start.
          </p>
        </section>
      </div>
    </>
  );
}

function updatedAgo(at: number, now: number): string {
  const m = Math.floor((now - at) / 6e4);
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
}
