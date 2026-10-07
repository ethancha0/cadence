"use client";

import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";
import { useNewTask } from "@/components/useNewTask";
import { byDueThenPriority, dueLabel, dueSoon, isoDate, PRIO_CLASS, PRIO_LABEL } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Category, Priority, Task } from "@/lib/types";

const PRIOS: Priority[] = ["high", "medium", "low"];
const DAY_MS = 864e5;

function isOlderThanDay(t: Task) {
  return Date.now() - new Date(t.created_at).getTime() > DAY_MS;
}

function TaskRow({ task: t, onDone, onDelete }: { task: Task; onDone: (id: string, done: boolean) => void; onDelete: (id: string) => void }) {
  const done = Boolean(t.done_at);
  return (
    <div className="task-row">
      <button className={`check${done ? " on" : ""}`} onClick={() => onDone(t.id, !done)} aria-label={done ? "Mark not done" : "Mark done"} aria-pressed={done}>
        {done && <Check size={12} strokeWidth={2.5} />}
      </button>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, opacity: done ? 0.5 : 1 }}>
        <span style={{ fontSize: 14, textDecoration: done ? "line-through" : "none" }}>{t.title}</span>
        <span className="card-meta" style={{ color: !done && dueSoon(t.due_date) ? "var(--color-accent-700)" : undefined }}>
          {done ? "Done" : dueLabel(t.due_date)}
        </span>
      </div>
      <span className={`tag ${PRIO_CLASS[t.priority]}`}>{PRIO_LABEL[t.priority]}</span>
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => onDelete(t.id)}
        aria-label="Delete task"
        style={{ color: "var(--color-neutral-600)" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default function TasksPage() {
  const { ready, data, activeCategories, setTaskDone, deleteTask } = useStore();
  const nt = useNewTask();

  if (!ready) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <header className="page-header tight">
        <h1 className="page-title">Tasks</h1>
        <p className="text-muted page-sub">
          Every task belongs to a category. Your pros and deltas are filed under that category, so they come back whenever you pick a task from it.
        </p>
      </header>

      <section className="card" style={{ padding: "var(--space-4)", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <span className="card-kicker">New task</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: "var(--space-4)", alignItems: "end" }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="nt-title">Task</label>
            <input
              id="nt-title"
              className="input"
              value={nt.title}
              onChange={(e) => nt.setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && nt.submit()}
              placeholder="e.g. ICS 46 · Problem set 5"
            />
          </div>
          <div className="field">
            <label htmlFor="nt-cat">Category</label>
            <select id="nt-cat" className="input" value={nt.cid} onChange={(e) => nt.setCategoryId(e.target.value)}>
              {nt.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Priority</label>
            <div className="seg" role="radiogroup" aria-label="Priority" style={{ display: "flex" }}>
              {PRIOS.map((p) => (
                <label key={p} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="prio" checked={nt.priority === p} onChange={() => nt.setPriority(p)} />
                  {PRIO_LABEL[p]}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="nt-due">Due date</label>
            <input id="nt-due" className="input" type="date" min={isoDate()} value={nt.due} onChange={(e) => nt.setDue(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <span className="text-muted xsmall">{!nt.categories.length && "Add a category below first."}</span>
            <button className="btn btn-primary" onClick={nt.submit} disabled={!nt.canAdd}>
              <Plus size={14} />
              Add task
            </button>
          </div>
        </div>
      </section>

      <div className="grid-cols" style={{ marginBottom: "var(--space-8)" }}>
        {activeCategories.map((c) => {
          const list = data.tasks
            .filter((t) => t.category_id === c.id)
            .sort((a, b) => Number(Boolean(a.done_at)) - Number(Boolean(b.done_at)) || byDueThenPriority(a, b));
          const recent = list.filter((t) => !isOlderThanDay(t));
          const older = list.filter(isOlderThanDay);
          return (
            <section key={c.id}>
              <div className="group-head">
                <h3>{c.name}</h3>
                <span className="card-meta tnum">{list.filter((t) => !t.done_at).length} open</span>
              </div>
              {recent.map((t) => (
                <TaskRow key={t.id} task={t} onDone={setTaskDone} onDelete={deleteTask} />
              ))}
              {older.length > 0 && (
                <details className="task-dropdown">
                  <summary>
                    <span className="task-dropdown-label">
                      <ChevronDown size={14} />
                      Older than a day
                    </span>
                    <span className="card-meta tnum">{older.length}</span>
                  </summary>
                  {older.map((t) => (
                    <TaskRow key={t.id} task={t} onDone={setTaskDone} onDelete={deleteTask} />
                  ))}
                </details>
              )}
              {!list.length && (
                <p className="text-muted small" style={{ padding: "var(--space-2) 0" }}>
                  No tasks yet.
                </p>
              )}
            </section>
          );
        })}
      </div>

      <CategoryEditor />
    </>
  );
}

function CategoryEditor() {
  const { categories, addCategory } = useStore();
  const [name, setName] = useState("");
  const taken = (n: string, except?: string) => categories.some((c) => c.id !== except && c.name.toLowerCase() === n.trim().toLowerCase());
  const canAdd = Boolean(name.trim()) && !taken(name);
  const submit = () => {
    if (!canAdd) return;
    addCategory(name.trim());
    setName("");
  };

  return (
    <section style={{ maxWidth: 560 }}>
      <h6>Categories</h6>
      <p className="text-muted xsmall" style={{ marginBottom: "var(--space-2)" }}>
        Rename in place. Archiving hides a category and its tasks but keeps its notes and history.
      </p>
      {categories.map((c) => (
        <CategoryRow key={c.id} c={c} taken={(n) => taken(n, c.id)} />
      ))}
      <div className="cat-row">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="New category…"
          aria-label="New category"
        />
        <button className="btn btn-primary" onClick={submit} disabled={!canAdd}>
          Add
        </button>
      </div>
      {name.trim() && taken(name) && <p className="xsmall" style={{ color: "var(--color-accent-700)" }}>That category already exists.</p>}
    </section>
  );
}

function CategoryRow({ c, taken }: { c: Category; taken: (n: string) => boolean }) {
  const { renameCategory, setCategoryArchived } = useStore();
  const [name, setName] = useState(c.name);
  const commit = () => {
    const n = name.trim();
    if (!n || n === c.name || taken(n)) return setName(c.name);
    renameCategory(c.id, n);
  };
  return (
    <div className="cat-row" style={{ opacity: c.archived ? 0.55 : 1 }}>
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label={`Rename ${c.name}`}
      />
      <button className="btn btn-secondary" onClick={() => setCategoryArchived(c.id, !c.archived)}>
        {c.archived ? "Restore" : "Archive"}
      </button>
    </div>
  );
}
