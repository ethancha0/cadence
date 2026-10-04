"use client";

import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { PinnedLines, ProDelta } from "@/components/notes";
import { useNewTask } from "@/components/useNewTask";
import { byDueThenPriority, dueLabel, dueSoon, fmtMin, isoDate, longDate, pad2, PRIO_CLASS, PRIO_LABEL, shortDate, shortMin } from "@/lib/format";
import { computeSplit } from "@/lib/split";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";

const PRESETS = [60, 90, 120, 180];

export default function PlanPage() {
  const store = useStore();
  const { ready, live, data, plan, setPlan, lastSession, lastAlloc, catName, cat, lastNote, pinnedFor, daysSinceTouched, beginSession } = store;
  const router = useRouter();
  const nt = useNewTask();

  useEffect(() => {
    if (live) router.replace("/session");
  }, [live, router]);

  const total = plan.length ?? lastSession?.planned_minutes ?? 60;

  const openTasks = useMemo(
    () => data.tasks.filter((t) => !t.done_at && cat(t.category_id) && !cat(t.category_id)!.archived).sort(byDueThenPriority),
    [data.tasks, cat],
  );

  const split = useMemo(() => {
    const chosen = plan.selected.map((id) => openTasks.find((t) => t.id === id)).filter((t): t is Task => Boolean(t));
    return computeSplit(
      chosen,
      total,
      { lastSession: lastSession ? { planned_minutes: lastSession.planned_minutes, alloc: lastAlloc } : null, daysSinceTouched },
      plan.overrides,
    );
  }, [plan.selected, plan.overrides, openTasks, total, lastSession, lastAlloc, daysSinceTouched]);

  const planned = split.reduce((a, s) => a + s.minutes, 0);
  const diff = planned - total;
  const selectedCats = [...new Set(split.map((s) => s.task.category_id))];
  const tooShort = total < 15;

  const toggle = (id: string) =>
    setPlan((p) => ({ ...p, overrides: {}, selected: p.selected.includes(id) ? p.selected.filter((x) => x !== id) : [...p.selected, id] }));
  const setLength = (m: number) => setPlan((p) => ({ ...p, length: m, overrides: {} }));
  const bump = (id: string, cur: number, d: number) => setPlan((p) => ({ ...p, overrides: { ...p.overrides, [id]: Math.max(5, cur + d) } }));

  const begin = async () => {
    if (!split.length || tooShort) return;
    await beginSession(split);
    router.push("/session");
  };

  const lastLabel = lastSession
    ? `Last session (${shortDate(lastSession.started_at)}) ran ${fmtMin(lastSession.planned_minutes)}: ` +
      Object.entries(lastAlloc).map(([c, m]) => `${catName(c)} ${m} min`).join(", ") + "."
    : "No previous session yet.";

  if (!ready) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <header className="page-header">
        <span className="card-kicker">{longDate()}</span>
        <h1 className="page-title">Plan this session</h1>
        <p className="text-muted page-sub">
          Choose your tasks and how long you have. Cadence brings back your notes for each category and suggests how to split the time.
        </p>
      </header>

      <div className="grid-cols">
        <div className="stack">
          <section>
            <div className="section-head">
              <h6>01 · To-do, by due date</h6>
              <span className="card-meta tnum">{split.length} selected</span>
            </div>
            <div className="todo-add">
              <input
                className="input"
                value={nt.title}
                onChange={(e) => nt.setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && nt.submit()}
                placeholder="Add a task…"
                aria-label="New task"
              />
              <button className="btn btn-primary" onClick={nt.submit} disabled={!nt.canAdd}>
                Add
              </button>
              <div className="todo-add-opts">
                <select className="input" value={nt.cid} onChange={(e) => nt.setCategoryId(e.target.value)} aria-label="Category">
                  {nt.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select className="input" value={nt.priority} onChange={(e) => nt.setPriority(e.target.value as Task["priority"])} aria-label="Priority">
                  <option value="high">High priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="low">Low priority</option>
                </select>
                <input className="input" type="date" min={isoDate()} value={nt.due} onChange={(e) => nt.setDue(e.target.value)} aria-label="Due date" />
              </div>
              {!nt.categories.length && (
                <p className="text-muted xsmall" style={{ gridColumn: "1 / -1", margin: 0 }}>
                  Create a category on the <Link href="/tasks">Tasks</Link> page first.
                </p>
              )}
            </div>
            {openTasks.map((t) => {
              const on = plan.selected.includes(t.id);
              return (
                <button key={t.id} className="todo-row" onClick={() => toggle(t.id)} aria-pressed={on}>
                  <span className={`check${on ? " on" : ""}`}>{on && <Check size={12} strokeWidth={2.5} />}</span>
                  <span className="todo-title">
                    <span>{t.title}</span>
                    <span className="tags">
                      <span className="tag tag-neutral">{catName(t.category_id)}</span>
                      <span className={`tag ${PRIO_CLASS[t.priority]}`}>{PRIO_LABEL[t.priority]}</span>
                    </span>
                  </span>
                  <span className={`due${dueSoon(t.due_date) ? " soon" : ""}`}>{dueLabel(t.due_date)}</span>
                </button>
              );
            })}
            {!openTasks.length && <p className="text-muted empty-line">No open tasks. Add one above.</p>}
          </section>

          <section>
            <h6>02 · Session length</h6>
            <p className="text-muted small" style={{ marginBottom: "var(--space-3)" }}>
              {lastLabel}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", alignItems: "center" }}>
              <div className="seg" role="radiogroup" aria-label="Session length presets">
                {PRESETS.map((m) => (
                  <label key={m} className="seg-opt">
                    <input type="radio" name="len" checked={total === m} onChange={() => setLength(m)} />
                    {shortMin(m)}
                    {lastSession?.planned_minutes === m ? " · last" : ""}
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <input
                  className="input tnum"
                  type="number"
                  min={15}
                  step={5}
                  value={total || ""}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setLength(isNaN(n) ? 0 : Math.max(0, n));
                  }}
                  aria-label="Minutes"
                  style={{ width: 88 }}
                />
                <span className="text-muted small">minutes</span>
              </div>
            </div>
            {tooShort && <p className="small" style={{ color: "var(--color-accent-700)", margin: "var(--space-2) 0 0" }}>Sessions are at least 15 minutes.</p>}
          </section>
        </div>

        <div className="stack">
          <section>
            <h6>03 · Notes from last time</h6>
            {!split.length && <p className="text-muted empty-line">Select tasks and your pros and deltas for their categories will show up here.</p>}
            {lastSession && split.length > 0 && (
              <article className="note-block compact">
                <div className="note-head">
                  <span className="card-title">Last session overall</span>
                  <span className="card-meta">{shortDate(lastSession.started_at)}</span>
                </div>
                <span className="small">
                  <span className="glyph">+ </span>
                  {lastSession.pro || "—"}
                </span>
                <span className="small">
                  <span className="glyph">Δ </span>
                  {lastSession.delta || "—"}
                </span>
              </article>
            )}
            {selectedCats.map((cid) => {
              const n = lastNote(cid);
              return (
                <article key={cid} className="note-block">
                  <div className="note-head">
                    <h3>{catName(cid)}</h3>
                    <span className="card-meta">{n ? shortDate(n.created_at) + (n.task_title ? " · " + n.task_title : "") : ""}</span>
                  </div>
                  {n ? <ProDelta note={n} /> : <p className="text-muted small" style={{ margin: 0 }}>No notes yet for this category.</p>}
                  <PinnedLines notes={pinnedFor(cid)} />
                </article>
              );
            })}
          </section>

          <section>
            <div className="section-head">
              <h6>04 · Suggested split</h6>
              {Object.keys(plan.overrides).length > 0 && (
                <button className="btn btn-ghost" onClick={() => setPlan((p) => ({ ...p, overrides: {} }))}>
                  Reset to suggestion
                </button>
              )}
            </div>
            {split.length > 0 && (
              <div className="split-bar">
                {split.map((s, i) => (
                  <div
                    key={s.task.id}
                    className="split-seg"
                    style={{ flex: `${s.minutes} 1 0`, background: i % 2 ? "var(--color-accent-200)" : "var(--color-accent-100)" }}
                  >
                    {catName(s.task.category_id)}
                  </div>
                ))}
              </div>
            )}
            {split.map((s, i) => (
              <div key={s.task.id} className="split-row">
                <span className="order-num">{pad2(i + 1)}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span className="split-title">{s.task.title}</span>
                  <span className="xsmall">{catName(s.task.category_id)}</span>
                  <span className="text-muted xsmall">{s.reason}</span>
                </div>
                <div className="stepper">
                  <button className="btn btn-secondary btn-icon" onClick={() => bump(s.task.id, s.minutes, -5)} aria-label="Less time">
                    <Minus size={14} />
                  </button>
                  <span className="mins">
                    {s.minutes}
                    <small> min</small>
                  </span>
                  <button className="btn btn-secondary btn-icon" onClick={() => bump(s.task.id, s.minutes, 5)} aria-label="More time">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div className="split-foot">
              <span className="small tnum">
                {split.length ? `${fmtMin(planned)} planned` + (diff ? ` · ${Math.abs(diff)} min ${diff > 0 ? "over" : "under"} your ${fmtMin(total)}` : "") : ""}
              </span>
              <button className="btn btn-primary btn-lg" onClick={begin} disabled={!split.length || tooShort}>
                Begin session
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
