"use client";

import { Pin } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { fmtMin, shortDate, sinceLabel } from "@/lib/format";
import { useStore } from "@/lib/store";

export default function HistoryPage() {
  return (
    <Suspense>
      <History />
    </Suspense>
  );
}

function History() {
  const { ready, activeCategories, notes, endedSessions, sessionAlloc, catName, daysSinceTouched, weekMinutes, togglePin } = useStore();
  const params = useSearchParams();
  const [picked, setPicked] = useState<string | null>(params.get("c"));

  if (!ready) return <p className="text-muted">Loading…</p>;

  const sel = activeCategories.find((c) => c.id === picked) ?? activeCategories[0];
  const max = Math.max(60, ...activeCategories.map((c) => weekMinutes(c.id)));
  const catNotes = sel ? notes.filter((n) => n.category_id === sel.id) : [];

  return (
    <>
      <header className="page-header tight">
        <h1 className="page-title">Notes &amp; history</h1>
      </header>
      <div className="hist-wrap">
        <div className="hist-list">
          {activeCategories.map((c) => {
            const since = daysSinceTouched(c.id);
            const w = weekMinutes(c.id);
            return (
              <button key={c.id} className="card hist-card" onClick={() => setPicked(c.id)} aria-pressed={c.id === sel?.id}>
                <span className="card-title">{c.name}</span>
                <span style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
                  <span className="card-meta" style={{ color: since != null && since >= 7 ? "var(--color-accent-700)" : undefined }}>
                    {sinceLabel(since)}
                  </span>
                  <span className="card-meta tnum">{fmtMin(w)} this week</span>
                </span>
                <div className="week-bar">
                  <div style={{ width: `${((w / max) * 100).toFixed(1)}%` }} />
                </div>
              </button>
            );
          })}
          {!activeCategories.length && <p className="text-muted">No categories yet.</p>}
        </div>

        <div className="hist-detail">
          {sel && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "var(--space-2)" }}>
                <h2 style={{ margin: 0, fontWeight: 400, fontSize: 40 }}>{sel.name}</h2>
                <span className="card-meta">
                  {sinceLabel(daysSinceTouched(sel.id))} · {fmtMin(weekMinutes(sel.id))} this week
                </span>
              </div>
              <h6 style={{ margin: "var(--space-6) 0 var(--space-2)" }}>Notes · pin any you want shown every time</h6>
              {catNotes.map((n) => (
                <article key={n.id} className="hist-row">
                  <span className="card-meta" style={{ alignSelf: "start" }}>
                    {shortDate(n.created_at)}
                  </span>
                  <div className="hist-row-body">
                    {n.task_title && <span className="card-meta">{n.task_title}</span>}
                    {n.pro && (
                      <span>
                        <span className="glyph">+ </span>
                        {n.pro}
                      </span>
                    )}
                    {n.delta && (
                      <span>
                        <span className="glyph">Δ </span>
                        {n.delta}
                      </span>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => togglePin(n.id)}
                    aria-label={n.pinned ? "Unpin note" : "Pin note"}
                    aria-pressed={n.pinned}
                    style={{ color: n.pinned ? "var(--color-accent)" : "var(--color-neutral-500)" }}
                  >
                    <Pin size={16} fill={n.pinned ? "currentColor" : "none"} />
                  </button>
                </article>
              ))}
              {!catNotes.length && <p className="text-muted">No notes yet.</p>}
            </>
          )}

          <h6 style={{ margin: "var(--space-8) 0 var(--space-2)" }}>Past sessions</h6>
          {endedSessions.map((s) => (
            <article key={s.id} className="hist-row two">
              <span className="card-meta">{shortDate(s.started_at)}</span>
              <div className="hist-row-body">
                <span className="card-meta tnum">
                  {fmtMin(s.planned_minutes)} ·{" "}
                  {Object.entries(sessionAlloc(s.id))
                    .map(([c, m]) => `${catName(c)} ${m}`)
                    .join(", ")}
                </span>
                <span>
                  <span className="glyph">+ </span>
                  {s.pro || "—"}
                </span>
                <span>
                  <span className="glyph">Δ </span>
                  {s.delta || "—"}
                </span>
              </div>
            </article>
          ))}
          {!endedSessions.length && <p className="text-muted">No sessions yet.</p>}
        </div>
      </div>
    </>
  );
}
