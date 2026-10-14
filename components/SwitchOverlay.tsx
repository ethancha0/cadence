"use client";

import { ArrowRight, Pause, Play, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clock, fmtMin, pad2, shortDate } from "@/lib/format";
import { useNow, useStore, type Live } from "@/lib/store";
import { noteText } from "./notes";

const DRAFT_KEY = (blockId: string) => `cadence:draft:${blockId}`;

interface Draft {
  pro: string;
  delta: string;
  done: boolean | null; // did the user fully complete the task? null = not answered yet
  sw: Stopwatch;
  extra: string | null; // minutes to add to time spent, as typed; null = use the stopwatch
}

/** Wall-clock stopwatch for time worked after the block ended, like a block's spent_seconds/resumed_at. */
interface Stopwatch {
  spent: number; // seconds banked while paused
  since: number | null; // epoch ms the current running stretch began; null = paused
}

const swSeconds = (sw: Stopwatch, now = Date.now()) => sw.spent + (sw.since ? Math.max(0, (now - sw.since) / 1000) : 0);

function readDraft(blockId: string): Partial<Draft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(blockId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The hard stop: full-screen, no dismiss, shown on any page when a block ends. */
export function SwitchOverlay() {
  const { live } = useStore();
  if (!live || live.phase !== "switch") return null;
  return <Overlay key={live.block.id} live={live} />;
}

function Overlay({ live }: { live: Live }) {
  const { catName, task, lastNote, pinnedFor, settings, finishBlock, setTaskDone } = useStore();
  const router = useRouter();
  const b = live.block;
  const t = task(b.task_id);
  const [draft, setDraft] = useState<Draft>(() => {
    const join = (k: "pro" | "delta") => b.quick_notes.filter((q) => q.kind === k).map((q) => q.text).join(" ");
    const saved = readDraft(b.id);
    return {
      pro: saved?.pro ?? join("pro"),
      delta: saved?.delta ?? join("delta"),
      done: saved?.done ?? (t?.done_at ? true : null),
      // Timer ran out: the user may not have noticed, so count from the moment it hit 0. Ended early: wait for Start.
      sw: saved?.sw ?? (b.spent_seconds >= b.planned_minutes * 60 && b.ended_at ? { spent: 0, since: Date.parse(b.ended_at) } : { spent: 0, since: null }),
      extra: saved?.extra ?? null,
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY(b.id), JSON.stringify(draft));
    } catch {}
  }, [b.id, draft]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const now = useNow(draft.sw.since !== null);
  const swSec = Math.floor(swSeconds(draft.sw, now));
  const extraSec = draft.extra === null ? swSec : Math.max(0, Math.round(Number(draft.extra) || 0)) * 60;
  const toggleSw = () =>
    setDraft((d) => ({ ...d, sw: d.sw.since ? { spent: swSeconds(d.sw), since: null } : { spent: d.sw.spent, since: Date.now() } }));

  const pro = draft.pro.trim(), delta = draft.delta.trim();
  const needsNotes = settings.requireNotes && !pro && !delta;
  const needsDone = Boolean(t) && draft.done === null;
  const blocked = needsNotes || needsDone;
  const nb = live.next;
  const nextNote = nb ? lastNote(nb.category_id) : null;
  const title = t?.title ?? b.task_title;

  const go = () => {
    if (blocked) return;
    if (t && draft.done !== null && draft.done !== Boolean(t.done_at)) setTaskDone(t.id, draft.done);
    const extra = draft.extra === null ? swSeconds(draft.sw) : extraSec;
    const endedSession = finishBlock(pro, delta, extra);
    try {
      localStorage.removeItem(DRAFT_KEY(b.id));
    } catch {}
    if (endedSession) router.push(`/summary/${endedSession}`);
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="switch-title">
      <div className="overlay-inner">
        <span aria-hidden="true" className="ghost-num">{pad2(live.index + 1)}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", position: "relative" }}>
          <span className="overlay-kicker">
            Block {live.index + 1} of {live.blocks.length} done · {catName(b.category_id)} · {fmtMin(b.spent_seconds / 60)}
          </span>
          <h1 id="switch-title" style={{ margin: 0, fontWeight: 400, fontSize: "clamp(40px, 7vw, 64px)" }}>
            Time to put this down.
          </h1>
          <p style={{ margin: 0, opacity: 0.75, maxWidth: "56ch" }}>
            {title}. Before you switch, write a line or two for next time. Quick notes from this block are already filled in.
          </p>
        </div>
        <div className="overlay-stopwatch">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span className="overlay-kicker">{draft.sw.since ? "Stopwatch · since time ran out" : "Stopwatch"}</span>
            <div className="stopwatch" role="timer" aria-live="off">
              {clock(swSec)}
            </div>
            <div className="btn-row">
              <button className="btn btn-secondary" onClick={toggleSw}>
                {draft.sw.since ? <Pause size={14} /> : <Play size={14} />}
                {draft.sw.since ? "Pause" : swSec > 0 ? "Resume" : "Start"}
              </button>
              <button className="btn btn-secondary" onClick={() => setDraft((d) => ({ ...d, sw: { spent: 0, since: null } }))} disabled={swSec === 0 && !draft.sw.since}>
                <RotateCcw size={14} />
                Reset
              </button>
            </div>
          </div>
          <div className="field" style={{ maxWidth: 280 }}>
            <label htmlFor="extra-min">Extra minutes to add to this block</label>
            <input
              id="extra-min"
              className="input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={draft.extra ?? String(Math.round(swSec / 60))}
              onChange={(e) => setDraft((d) => ({ ...d, extra: e.target.value }))}
            />
            <p style={{ margin: "var(--space-2) 0 0", fontSize: 13, opacity: 0.75 }}>
              {fmtMin(b.spent_seconds / 60)} + {fmtMin(extraSec / 60)} = {fmtMin((b.spent_seconds + extraSec) / 60)} spent
              {draft.extra !== null && (
                <>
                  {" · "}
                  <button className="btn btn-ghost" style={{ padding: 0, fontSize: 13 }} onClick={() => setDraft((d) => ({ ...d, extra: null }))}>
                    Use stopwatch
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
        {t && (
          <div className="field" style={{ position: "relative" }}>
            <label id="done-q">Did you fully complete this task?</label>
            <div className="seg" role="radiogroup" aria-labelledby="done-q">
              <label className="seg-opt">
                <input type="radio" name="task-done" checked={draft.done === true} onChange={() => setDraft((d) => ({ ...d, done: true }))} />
                Yes, it&apos;s done
              </label>
              <label className="seg-opt">
                <input type="radio" name="task-done" checked={draft.done === false} onChange={() => setDraft((d) => ({ ...d, done: false }))} />
                Not yet, keep it on my list
              </label>
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "var(--space-4)", position: "relative" }}>
          <div className="field">
            <label htmlFor="draft-pro">+ Pro: what worked</label>
            <textarea id="draft-pro" className="input" value={draft.pro} onChange={(e) => setDraft((d) => ({ ...d, pro: e.target.value }))} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="draft-delta">Δ Delta: what to change</label>
            <textarea id="draft-delta" className="input" value={draft.delta} onChange={(e) => setDraft((d) => ({ ...d, delta: e.target.value }))} />
          </div>
        </div>
        {nb && (
          <div className="overlay-next">
            <span className="overlay-kicker">
              Up next · {catName(nb.category_id)} · {nb.planned_minutes} min
            </span>
            <h2 style={{ margin: 0, fontWeight: 400, fontSize: 38 }}>{task(nb.task_id)?.title ?? nb.task_title}</h2>
            {nextNote && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: "var(--space-4)", marginTop: "var(--space-2)" }}>
                <div>
                  <div className="pd-label">+ Last time · {shortDate(nextNote.created_at)}</div>
                  <p className="pd-text" style={{ fontSize: 22 }}>{nextNote.pro || "—"}</p>
                </div>
                <div>
                  <div className="pd-label">Δ Change this time</div>
                  <p className="pd-text" style={{ fontSize: 22 }}>{nextNote.delta || "—"}</p>
                </div>
              </div>
            )}
            {pinnedFor(nb.category_id).map((n) => (
              <span key={n.id} style={{ fontSize: 13, opacity: 0.8 }}>
                Pinned: {noteText(n)}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {blocked && (
            <span style={{ fontSize: 13, opacity: 0.7 }}>
              {needsDone && needsNotes
                ? "Answer whether the task is done and write a pro or a delta to continue."
                : needsDone
                  ? "Answer whether the task is done to continue."
                  : "Write a pro or a delta to continue."}
            </span>
          )}
          <button className="btn btn-primary btn-lg" onClick={go} disabled={blocked}>
            {nb ? `Start ${catName(nb.category_id)}` : "Wrap up session"}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
