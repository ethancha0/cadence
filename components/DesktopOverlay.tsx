"use client";

import { ArrowUpRight, Check, ChevronDown, ChevronUp, Pause, Play, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { byDueThenPriority, clock, daysSince, dueLabel, fmtMin, isoDate, PRIO_LABEL, timeOfDay } from "@/lib/format";
import { elapsedSeconds, useNow, useStore, type Live } from "@/lib/store";
import type { Block, QuickNote, Task } from "@/lib/types";

/** Set by the desktop shell's preload script (desktop/preload.cjs); absent in a normal browser tab. */
interface DesktopBridge {
  shortcut: string;
  setInteractive(on: boolean): void;
  setGlass(on: boolean): void;
  resize(height: number): void;
  open(path: string): void;
}

declare global {
  interface Window {
    cadenceDesktop?: DesktopBridge;
  }
}

const noSubscribe = () => () => {};

function openApp(path: string) {
  if (window.cadenceDesktop) window.cadenceDesktop.open(path);
  else window.open(path, "cadence");
}

/** Look settings from the URL: /overlay?tone=light&rest=0.3&opacity=0.72 */
function usePrefs() {
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  return useMemo(() => {
    const q = new URLSearchParams(search);
    const num = (key: string, lo: number, hi: number, fallback: number) => {
      const v = Number(q.get(key));
      return q.has(key) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
    };
    const opacity = num("opacity", 0.5, 0.95, 0.72);
    return { tone: q.get("tone") === "light" ? "light" : "dark", opacity, rest: Math.min(opacity, num("rest", 0.1, 0.6, 0.3)) };
  }, [search]);
}

function useBlockClock(b: Block) {
  const running = Boolean(b.resumed_at);
  const now = useNow(running);
  const planned = b.planned_minutes * 60;
  const remaining = Math.max(0, planned - elapsedSeconds(b, now));
  return { running, now, remaining, progress: `${((1 - remaining / planned) * 100).toFixed(1)}%` };
}

/** The always-on-top panel the desktop shell shows in the top-right corner: the live block, the session, and today's tasks. */
export function DesktopOverlay() {
  const { ready, error, live } = useStore();
  const prefs = usePrefs();
  const shortcut = useSyncExternalStore(noSubscribe, () => window.cadenceDesktop?.shortcut ?? null, () => null);
  const [hovered, setHovered] = useState(false);
  const [compact, setCompact] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // The hard stop stays solid: it's the one moment the overlay needs to be noticed.
  const solid = hovered || live?.phase === "switch";

  // Desktop shell: the window is sized to the panel, clicks pass through it until the pointer is over it,
  // and what's behind is only blurred while it's solid.
  useEffect(() => {
    const el = panel.current, bridge = window.cadenceDesktop;
    if (!el || !bridge) return;
    const ro = new ResizeObserver(() => bridge.resize(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    window.cadenceDesktop?.setInteractive(hovered);
  }, [hovered]);
  useEffect(() => {
    window.cadenceDesktop?.setGlass(solid);
  }, [solid]);

  const style = { "--ov-alpha": prefs.opacity, "--ov-rest-alpha": prefs.rest } as CSSProperties;
  const showCompact = Boolean(live && compact && live.phase === "run");

  return (
    <div className="ov-shell" data-desktop={shortcut ? "" : undefined}>
      <div
        ref={panel}
        className="ov"
        data-tone={prefs.tone}
        data-solid={solid ? "" : undefined}
        style={style}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {!ready ? (
          <p className="ov-pad ov-muted">Loading…</p>
        ) : live?.phase === "switch" ? (
          <HardStop key={live.block.id} live={live} />
        ) : live && showCompact ? (
          <CompactBar live={live} onExpand={() => setCompact(false)} />
        ) : live ? (
          <Running live={live} onCollapse={() => setCompact(true)} />
        ) : (
          <Idle />
        )}
        {error && <p className="ov-pad ov-rule ov-error">{error}</p>}
        {!showCompact && (
          <div className="ov-foot">
            <span>{shortcut && `${shortcut} hides this`}</span>
            <button className="ov-link" onClick={() => openApp("/")}>
              Open Cadence
              <ArrowUpRight size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Running({ live, onCollapse }: { live: Live; onCollapse: () => void }) {
  const { catName, task, lastNote, setTaskDone, pause, resume, endBlock } = useStore();
  const b = live.block;
  const { running, now, remaining, progress } = useBlockClock(b);
  const t = task(b.task_id);
  const done = Boolean(t?.done_at);
  const cat = catName(b.category_id);
  const note = lastNote(b.category_id);
  const after = live.blocks.slice(live.index + 1).reduce((a, x) => a + x.planned_minutes * 60, 0);

  return (
    <>
      <div className="ov-head">
        <span className="ov-dot" data-on={running ? "" : undefined} aria-hidden="true" />
        <span className="ov-kicker ov-accent">{running ? "In session" : "Paused"}</span>
        <span className="ov-muted xsmall">
          Block {live.index + 1} of {live.blocks.length}
        </span>
        <button className="ov-icon" onClick={onCollapse} aria-label="Collapse to one line">
          <ChevronUp size={16} />
        </button>
      </div>

      <section className="ov-pad ov-block">
        <span className="ov-muted xsmall">{cat}</span>
        <span className="ov-title" style={{ textDecoration: done ? "line-through" : undefined }}>
          {t?.title ?? b.task_title}
        </span>
        <div className="ov-timer-row">
          <span className="ov-timer" role="timer" aria-live="off">
            {clock(remaining)}
          </span>
          <span className="ov-timer-meta ov-muted xsmall">
            <span>of {b.planned_minutes} min</span>
            <span>{running ? `until ${timeOfDay(now + remaining * 1000)}` : "paused"}</span>
          </span>
        </div>
        <div className="ov-progress">
          <div style={{ width: progress }} />
        </div>
        <div className="ov-actions">
          <button className="ov-btn" onClick={running ? pause : resume}>
            {running ? <Pause size={13} /> : <Play size={13} />}
            {running ? "Pause" : "Resume"}
          </button>
          <button className="ov-btn" aria-pressed={done} onClick={() => t && setTaskDone(t.id, !done)} disabled={!t}>
            <Check size={13} strokeWidth={2.5} />
            {done ? "Done" : "Mark done"}
          </button>
          <button className="ov-btn" onClick={() => endBlock("early")}>
            <SkipForward size={13} />
            End
          </button>
        </div>
      </section>

      <section className="ov-pad ov-rule ov-session">
        <span className="ov-kicker ov-muted">
          {fmtMin(live.session.planned_minutes)} session · {running ? `ends ${timeOfDay(now + (remaining + after) * 1000)}` : "paused"}
        </span>
        <div className="ov-ribbon">
          {live.blocks.map((x, i) => (
            <div
              key={x.id}
              className="ov-seg"
              data-state={i < live.index ? "done" : i === live.index ? "current" : undefined}
              style={{ flex: `${x.planned_minutes} 1 0` }}
            >
              <div />
              <span>
                {catName(x.category_id)} {x.planned_minutes}′
              </span>
            </div>
          ))}
        </div>
      </section>

      {note && (
        <section className="ov-pad ov-rule ov-note">
          <span className="ov-glyph" aria-hidden="true">
            {note.delta ? "Δ" : "+"}
          </span>
          <div>
            <span className="ov-kicker ov-muted">Last time on {cat}</span>
            <p>{note.delta || note.pro}</p>
          </div>
        </section>
      )}

      <TaskList rows={4.5} />
    </>
  );
}

function CompactBar({ live, onExpand }: { live: Live; onExpand: () => void }) {
  const { catName, task, pause, resume } = useStore();
  const b = live.block;
  const { running, remaining, progress } = useBlockClock(b);

  return (
    <>
      <div className="ov-compact">
        <span className="ov-dot" data-on={running ? "" : undefined} aria-hidden="true" />
        <div className="ov-compact-text">
          <span className="ov-muted">
            {catName(b.category_id)} · Block {live.index + 1} of {live.blocks.length}
          </span>
          <span>{task(b.task_id)?.title ?? b.task_title}</span>
        </div>
        <span className="ov-timer sm" role="timer" aria-live="off">
          {clock(remaining)}
        </span>
        <button className="ov-icon filled" onClick={running ? pause : resume} aria-label={running ? "Pause" : "Resume"}>
          {running ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button className="ov-icon" onClick={onExpand} aria-label="Expand">
          <ChevronDown size={16} />
        </button>
      </div>
      <div className="ov-progress flush">
        <div style={{ width: progress }} />
      </div>
    </>
  );
}

const joinQuick = (b: Block, kind: QuickNote["kind"]) =>
  b.quick_notes
    .filter((q) => q.kind === kind)
    .map((q) => q.text)
    .join(" ");

/** A compact version of the full-screen hard stop (SwitchOverlay): same rules, same result. */
function HardStop({ live }: { live: Live }) {
  const { catName, task, lastNote, settings, finishBlock, setTaskDone } = useStore();
  const b = live.block;
  const t = task(b.task_id);
  const nb = live.next;
  const nextNote = nb ? lastNote(nb.category_id) : null;
  const [notes, setNotes] = useState(() => ({ pro: joinQuick(b, "pro"), delta: joinQuick(b, "delta") }));
  const [kind, setKind] = useState<QuickNote["kind"]>("delta");
  const [done, setDone] = useState<boolean | null>(t?.done_at ? true : null);

  // Timer ran out rather than ended early: count the time worked past it, like the full-screen stopwatch does.
  const ranOutAt = b.ended_at && b.spent_seconds >= b.planned_minutes * 60 ? Date.parse(b.ended_at) : null;
  const now = useNow(ranOutAt !== null, 1000);
  const over = ranOutAt === null ? 0 : Math.max(0, Math.floor((now - ranOutAt) / 1000));

  const pro = notes.pro.trim(), delta = notes.delta.trim();
  const needsNotes = settings.requireNotes && !pro && !delta;
  const needsDone = Boolean(t) && done === null;

  const go = () => {
    if (needsNotes || needsDone) return;
    if (t && done !== null && done !== Boolean(t.done_at)) setTaskDone(t.id, done);
    const ended = finishBlock(pro, delta, over);
    if (ended) openApp(`/summary/${ended}`);
  };

  return (
    <div className="ov-pad ov-stop">
      <div className="ov-stack">
        <span className="ov-kicker ov-accent">
          Hard stop · Block {live.index + 1} of {live.blocks.length}
        </span>
        <span className="ov-title lg">Time to put this down.</span>
        <span className="ov-muted small">
          {catName(b.category_id)} · {t?.title ?? b.task_title}
        </span>
      </div>

      <div className="ov-field-row">
        <span className="ov-muted xsmall">{ranOutAt === null ? "Ended early" : "Over by"}</span>
        <span className="ov-timer xs" role="timer" aria-live="off">
          {ranOutAt === null ? fmtMin(b.spent_seconds / 60) : `+${clock(over)}`}
        </span>
      </div>

      {t && (
        <div className="ov-stack">
          <span id="ov-done-q" className="ov-muted xsmall">
            Finished the task?
          </span>
          <div className="ov-pair" role="group" aria-labelledby="ov-done-q">
            <button className="ov-btn" aria-pressed={done === true} onClick={() => setDone(true)}>
              Yes, done
            </button>
            <button className="ov-btn" aria-pressed={done === false} onClick={() => setDone(false)}>
              Not yet
            </button>
          </div>
        </div>
      )}

      <div className="ov-stack">
        <div className="ov-note-head">
          <label htmlFor="ov-note" className="ov-muted xsmall">
            A line for next time
          </label>
          <div className="ov-toggle" role="group" aria-label="Note kind">
            <button aria-pressed={kind === "pro"} onClick={() => setKind("pro")}>
              + Pro
            </button>
            <button aria-pressed={kind === "delta"} onClick={() => setKind("delta")}>
              Δ Delta
            </button>
          </div>
        </div>
        <input
          id="ov-note"
          className="ov-input"
          value={notes[kind]}
          onChange={(e) => setNotes((n) => ({ ...n, [kind]: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder={kind === "pro" ? "What worked? Keep doing it." : "What should change next time?"}
        />
      </div>

      {nb && (
        <div className="ov-next">
          <span className="ov-kicker ov-muted">
            Up next · {nb.planned_minutes} min
          </span>
          <span className="ov-title sm">{task(nb.task_id)?.title ?? nb.task_title}</span>
          {nextNote && (
            <span className="ov-muted xsmall">
              {nextNote.delta ? "Δ" : "+"} {nextNote.delta || nextNote.pro}
            </span>
          )}
        </div>
      )}

      {(needsDone || needsNotes) && (
        <span className="ov-muted xsmall">
          {needsDone && needsNotes ? "Answer whether it's done and write a pro or a delta." : needsDone ? "Answer whether it's done." : "Write a pro or a delta."}
        </span>
      )}
      <button className="ov-primary" onClick={go} disabled={needsDone || needsNotes}>
        {nb ? `Start ${catName(nb.category_id)}` : "Wrap up session"}
      </button>
    </div>
  );
}

function Idle() {
  const { lastSession, blocksOf } = useStore();
  let last = "Plan one to get started.";
  if (lastSession) {
    const days = daysSince(lastSession.started_at);
    const spent = blocksOf(lastSession.id).reduce((a, b) => a + b.spent_seconds / 60, 0);
    last = `Last one ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}, ${fmtMin(spent)}.`;
  }

  return (
    <>
      <div className="ov-pad ov-stack">
        <span className="ov-title">Cadence</span>
        <span className="ov-muted xsmall">No session running. {last}</span>
      </div>
      <TaskList rows={6.5} />
      <div className="ov-pad">
        <button className="ov-primary" onClick={() => openApp("/")}>
          Plan a session
        </button>
      </div>
    </>
  );
}

const TASK_ROW_PX = 48;

/**
 * Session tasks first (in block order), then the rest by due date. Tasks finished today stay, struck through.
 * Shows about `rows` rows and scrolls the rest; a half row hints that there's more.
 */
function TaskList({ rows }: { rows: number }) {
  const { data, live, cat, catName, setTaskDone } = useStore();
  const [open, setOpen] = useState(true);

  const tasks = useMemo(() => {
    const today = isoDate();
    const order = live ? live.blocks.map((b) => b.task_id) : [];
    const rank = (t: Task) => (order.includes(t.id) ? order.indexOf(t.id) : order.length);
    return data.tasks
      .filter((t) => {
        const c = cat(t.category_id);
        return c && !c.archived && (!t.done_at || isoDate(new Date(t.done_at)) === today);
      })
      .sort((a, b) => rank(a) - rank(b) || byDueThenPriority(a, b));
  }, [data.tasks, live, cat]);

  const nowId = live?.phase === "run" ? live.block.task_id : null;
  const nextId = live?.next?.task_id ?? null;

  return (
    <section className="ov-rule">
      <button className="ov-tasks-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ov-kicker ov-muted">Tasks</span>
        <span className="ov-muted xsmall">
          {tasks.filter((t) => t.done_at).length} of {tasks.length} done
          <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} />
        </span>
      </button>
      {open && (
        <div className="ov-tasks" style={{ maxHeight: rows * TASK_ROW_PX }}>
          {!tasks.length && <p className="ov-pad ov-muted xsmall">No open tasks.</p>}
          {tasks.map((t) => {
            const badge = t.done_at ? null : t.id === nowId ? "Now" : t.id === nextId ? "Next" : null;
            return (
              <label key={t.id} className="ov-task" data-now={badge === "Now" ? "" : undefined}>
                <input type="checkbox" checked={Boolean(t.done_at)} onChange={() => setTaskDone(t.id, !t.done_at)} />
                <span className="ov-task-text">
                  <span data-done={t.done_at ? "" : undefined}>{t.title}</span>
                  <span className="ov-muted">
                    {catName(t.category_id)} · {dueLabel(t.due_date).split(" · ")[0]} · {PRIO_LABEL[t.priority]}
                  </span>
                </span>
                {badge && <span className="ov-kicker ov-accent">{badge}</span>}
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
