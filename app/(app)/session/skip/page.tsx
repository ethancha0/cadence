"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { PlannedLanding } from "@/components/PlannedLanding";
import { timeRange } from "@/lib/day";
import { useStore } from "@/lib/store";
import type { PlannedSession } from "@/lib/types";

const REASONS = ["Plans changed", "Something urgent", "Too tired"];

export default function SkipPage() {
  const [done, setDone] = useState<PlannedSession | null>(null);
  if (done) {
    return (
      <div className="phone-page">
        <span className="card-kicker">Skipped · {timeRange(done.starts_at, done.ends_at)}</span>
        <h1 className="phone-title">Skipped. Its tasks are back in your suggestions.</h1>
        <p className="text-muted" style={{ margin: 0 }}>
          <Link href="/day">Open your day</Link> to find another window.
        </p>
      </div>
    );
  }
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <PlannedLanding>{(p) => <Skip p={p} onSkipped={setDone} />}</PlannedLanding>
    </Suspense>
  );
}

function Skip({ p, onSkipped }: { p: PlannedSession; onSkipped: (p: PlannedSession) => void }) {
  const { updatePlanned } = useStore();
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const text = reason === "Other" ? other.trim() : reason;

  const skip = async () => {
    if (!text) return;
    await updatePlanned(p.id, { status: "skipped", skip_reason: text });
    onSkipped(p);
  };

  return (
    <div className="phone-page">
      <span className="card-kicker">Skip · {timeRange(p.starts_at, p.ends_at)}</span>
      <h1 className="phone-title">Skipping is fine. What happened?</h1>
      <div role="radiogroup" aria-label="Reason" className="stack-sm">
        {[...REASONS, "Other"].map((r) => (
          <label key={r} className="opt">
            <input type="radio" name="why" checked={reason === r} onChange={() => setReason(r)} />
            <span>{r}</span>
          </label>
        ))}
      </div>
      {reason === "Other" && (
        <div className="field">
          <label htmlFor="other">What came up?</label>
          <input id="other" className="input" value={other} onChange={(e) => setOther(e.target.value)} maxLength={200} autoFocus style={{ minHeight: 44 }} />
        </div>
      )}
      <p className="text-muted xsmall" style={{ margin: 0 }}>
        Its tasks go back into the suggestions for your next window.
      </p>
      <button className="btn btn-primary btn-lg btn-block-phone" onClick={skip} disabled={!text}>
        Skip this session
      </button>
    </div>
  );
}
