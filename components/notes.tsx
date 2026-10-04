import { Pin } from "lucide-react";
import type { Note } from "@/lib/types";

export const noteText = (n: Note) => [n.pro, n.delta].filter(Boolean).join(" / ");

/** "+ PRO" / "Δ DELTA" pair from a category's last note. */
export function ProDelta({ note, proLabel = "+ Pro", deltaLabel = "Δ Delta", large = false }: { note: Note; proLabel?: string; deltaLabel?: string; large?: boolean }) {
  return (
    <div className="pd-grid">
      <div>
        <div className="pd-label">{proLabel}</div>
        <p className={`pd-text${large ? " lg" : ""}`}>{note.pro || "—"}</p>
      </div>
      <div>
        <div className="pd-label">{deltaLabel}</div>
        <p className={`pd-text${large ? " lg" : ""}`}>{note.delta || "—"}</p>
      </div>
    </div>
  );
}

export function PinnedLines({ notes, prefix = true }: { notes: Note[]; prefix?: boolean }) {
  return notes.map((n) => (
    <div key={n.id} className="pinned-line">
      <Pin size={14} strokeWidth={2} />
      <span>
        {prefix && <span className="text-muted">Pinned · </span>}
        {noteText(n)}
      </span>
    </div>
  ));
}
