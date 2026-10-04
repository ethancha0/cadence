"use client";

import { Check, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PinnedLines, ProDelta } from "@/components/notes";
import { clock, pad2, shortDate } from "@/lib/format";
import { elapsedSeconds, useNow, useStore } from "@/lib/store";
import type { QuickNote } from "@/lib/types";

export default function ActivePage() {
  const { ready, live, catName, task, lastNote, pinnedFor, pause, resume, endBlock, addQuickNote, setTaskDone } = useStore();
  const running = Boolean(live && live.phase === "run" && live.block.resumed_at);
  const now = useNow(running);
  const [kind, setKind] = useState<QuickNote["kind"]>("pro");
  const [text, setText] = useState("");

  if (!ready) return <p className="text-muted">Loading…</p>;
  if (!live) {
    return (
      <header className="page-header">
        <h1 className="page-title">No session running</h1>
        <p className="text-muted page-sub">
          <Link href="/">Plan a session</Link> to start the timer.
        </p>
      </header>
    );
  }

  const b = live.block;
  const t = task(b.task_id);
  const done = Boolean(t?.done_at);
  const planned = b.planned_minutes * 60;
  const remaining = live.phase === "switch" ? 0 : Math.max(0, planned - elapsedSeconds(b, now));
  const note = lastNote(b.category_id);

  const addQuick = () => {
    const v = text.trim();
    if (!v) return;
    addQuickNote({ kind, text: v });
    setText("");
  };

  return (
    <>
      <div className="ribbon">
        {live.blocks.map((x, i) => (
          <div key={x.id} className={`ribbon-seg${i < live.index ? " done" : i === live.index ? " current" : ""}`} style={{ flex: `${x.planned_minutes} 1 0` }}>
            <span>{task(x.task_id)?.title ?? x.task_title}</span>
            <span className="tnum">{x.planned_minutes}′</span>
          </div>
        ))}
      </div>

      <section className="active-main">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span className="card-kicker">
            Block {pad2(live.index + 1)} of {pad2(live.blocks.length)} · {b.planned_minutes} min
          </span>
          <span className="small">{catName(b.category_id)}</span>
          <h2 style={{ margin: 0, fontWeight: 400, fontSize: 34, textDecoration: done ? "line-through" : "none" }}>{t?.title ?? b.task_title}</h2>
          <div className="timer" role="timer" aria-live="off">
            {clock(remaining)}
          </div>
          <div className="progress">
            <div style={{ width: `${((1 - remaining / planned) * 100).toFixed(1)}%` }} />
          </div>
          <div className="btn-row" style={{ marginTop: "var(--space-3)" }}>
            <button className="btn btn-secondary" onClick={running ? pause : resume}>
              {running ? <Pause size={14} /> : <Play size={14} />}
              {running ? "Pause" : "Resume"}
            </button>
            <button className="btn btn-secondary" onClick={() => t && setTaskDone(t.id, !done)} disabled={!t}>
              <Check size={14} strokeWidth={2.5} />
              {done ? "Marked done" : "Mark task done"}
            </button>
            <button className="btn btn-secondary" onClick={() => endBlock("early")}>
              End block early
            </button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span className="card-kicker">
            Last time on {catName(b.category_id)} · {note ? shortDate(note.created_at) : "no notes yet"}
          </span>
          {note ? (
            <ProDelta note={note} proLabel="+ Pro: keep doing" deltaLabel="Δ Delta: change this time" large />
          ) : (
            <p className="text-muted" style={{ margin: 0 }}>
              No notes yet. Today&apos;s will show up here next time.
            </p>
          )}
          <PinnedLines notes={pinnedFor(b.category_id)} prefix={false} />
        </div>
      </section>

      <section style={{ paddingTop: "var(--space-6)", maxWidth: 720 }}>
        <h6>Quick note</h6>
        <p className="text-muted xsmall" style={{ marginBottom: "var(--space-2)" }}>
          Write it down when you notice it. It&apos;ll be filled in when the block ends.
        </p>
        <div className="btn-row">
          <div className="seg" role="radiogroup" aria-label="Note kind">
            <label className="seg-opt">
              <input type="radio" name="qk" checked={kind === "pro"} onChange={() => setKind("pro")} />+ Pro
            </label>
            <label className="seg-opt">
              <input type="radio" name="qk" checked={kind === "delta"} onChange={() => setKind("delta")} />Δ Delta
            </label>
          </div>
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addQuick()}
            placeholder="e.g. Checking Slack broke my focus"
            aria-label="Quick note"
            style={{ flex: "1 1 200px", width: "auto" }}
          />
          <button className="btn btn-primary" onClick={addQuick} disabled={!text.trim()}>
            Add
          </button>
        </div>
        {b.quick_notes.map((q, i) => (
          <div key={i} className="quick-list-item">
            <span className="glyph" style={{ flex: "none" }}>
              {q.kind === "pro" ? "+" : "Δ"}
            </span>
            <span>{q.text}</span>
          </div>
        ))}
      </section>
    </>
  );
}
