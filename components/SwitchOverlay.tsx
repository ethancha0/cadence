"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtMin, pad2, shortDate } from "@/lib/format";
import { useStore, type Live } from "@/lib/store";
import { noteText } from "./notes";

const DRAFT_KEY = (blockId: string) => `cadence:draft:${blockId}`;

function readDraft(blockId: string): { pro: string; delta: string } | null {
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
  const { catName, task, lastNote, pinnedFor, settings, finishBlock } = useStore();
  const router = useRouter();
  const b = live.block;
  const [draft, setDraft] = useState(() => {
    const saved = readDraft(b.id);
    if (saved) return saved;
    const join = (k: "pro" | "delta") => b.quick_notes.filter((q) => q.kind === k).map((q) => q.text).join(" ");
    return { pro: join("pro"), delta: join("delta") };
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

  const pro = draft.pro.trim(), delta = draft.delta.trim();
  const blocked = settings.requireNotes && !pro && !delta;
  const nb = live.next;
  const nextNote = nb ? lastNote(nb.category_id) : null;
  const title = task(b.task_id)?.title ?? b.task_title;

  const go = () => {
    if (blocked) return;
    const endedSession = finishBlock(pro, delta);
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
          {blocked && <span style={{ fontSize: 13, opacity: 0.7 }}>Write a pro or a delta to continue.</span>}
          <button className="btn btn-primary btn-lg" onClick={go} disabled={blocked}>
            {nb ? `Start ${catName(nb.category_id)}` : "Wrap up session"}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
