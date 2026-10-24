"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useNewTask } from "@/components/useNewTask";
import { dueLabel, dueSoon, isoDate, PRIO_CLASS, PRIO_LABEL } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";

/** The to-do list: an "add a task" form, then open tasks to toggle in or out of a session. Used on Plan and Day. */
export function TaskPicker({ tasks, selected, onToggle }: { tasks: Task[]; selected: string[]; onToggle: (id: string) => void }) {
  const { catName } = useStore();
  const nt = useNewTask();

  return (
    <>
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
      {tasks.map((t) => {
        const on = selected.includes(t.id);
        return (
          <button key={t.id} className="todo-row" onClick={() => onToggle(t.id)} aria-pressed={on}>
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
      {!tasks.length && <p className="text-muted empty-line">No open tasks. Add one above.</p>}
    </>
  );
}
