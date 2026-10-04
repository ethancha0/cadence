"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { fmtMin, longDate } from "@/lib/format";
import { useStore } from "@/lib/store";

export default function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, sessions, blocksOf, catName, task, data, saveReflection } = useStore();
  const router = useRouter();
  const session = sessions.find((s) => s.id === id);
  const [pro, setPro] = useState<string | null>(null);
  const [delta, setDelta] = useState<string | null>(null);

  if (!ready) return <p className="text-muted">Loading…</p>;
  if (!session) {
    return (
      <header className="page-header">
        <h1 className="page-title">Session not found</h1>
        <p className="text-muted page-sub">
          <Link href="/">Back to planning</Link>
        </p>
      </header>
    );
  }

  const blocks = blocksOf(session.id);
  const spent = blocks.reduce((a, b) => a + b.spent_seconds / 60, 0);
  const rows = blocks.map((b) => {
    const t = task(b.task_id);
    const n = data.notes.find((x) => x.block_id === b.id);
    return { b, title: t?.title ?? b.task_title, done: Boolean(t?.done_at), pro: n?.pro || "—", delta: n?.delta || "—" };
  });
  const proVal = pro ?? session.pro ?? "";
  const deltaVal = delta ?? session.delta ?? "";

  const save = () => {
    saveReflection(session.id, proVal.trim(), deltaVal.trim());
    router.push(blocks[0] ? `/history?c=${blocks[0].category_id}` : "/history");
  };

  return (
    <>
      <header className="page-header tight">
        <span className="card-kicker">{longDate(new Date(session.started_at))}</span>
        <h1 className="page-title">Session complete</h1>
        <p className="text-muted" style={{ margin: 0 }}>
          {blocks.length} tasks · {fmtMin(spent)} of focused time
        </p>
      </header>

      <div style={{ overflowX: "auto", marginBottom: "var(--space-8)" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>Planned</th>
              <th style={{ textAlign: "right" }}>Spent</th>
              <th style={{ textAlign: "right" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ b, title, done }) => (
              <tr key={b.id}>
                <td style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16 }}>{title}</td>
                <td>{catName(b.category_id)}</td>
                <td className="num">{b.planned_minutes} min</td>
                <td className="num">{fmtMin(b.spent_seconds / 60)}</td>
                <td style={{ textAlign: "right" }}>{done ? "Done" : "In progress"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: "var(--space-8)", alignItems: "start" }}>
        <section>
          <h6>Notes saved for next time</h6>
          {rows.map(({ b, title, pro, delta }) => (
            <article key={b.id} className="note-block compact">
              <span className="card-title">
                {catName(b.category_id)} · {title}
              </span>
              <span className="small">
                <span className="glyph">+ </span>
                {pro}
              </span>
              <span className="small">
                <span className="glyph">Δ </span>
                {delta}
              </span>
            </article>
          ))}
        </section>
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <h6 style={{ margin: 0 }}>The session as a whole</h6>
          <p className="text-muted small" style={{ margin: 0 }}>
            How did switching go? This shows when you plan your next session.
          </p>
          <div className="field">
            <label htmlFor="s-pro">+ Pro</label>
            <textarea id="s-pro" className="input" value={proVal} onChange={(e) => setPro(e.target.value)} placeholder="e.g. Hard stops kept me from sinking into classwork" />
          </div>
          <div className="field">
            <label htmlFor="s-delta">Δ Delta</label>
            <textarea id="s-delta" className="input" value={deltaVal} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. Start with the shortest block to warm up" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={save}>
              Save and finish
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
