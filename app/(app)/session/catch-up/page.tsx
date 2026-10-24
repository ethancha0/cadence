"use client";

import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { PlannedLanding } from "@/components/PlannedLanding";
import { atTime, clockTime, hhmm, shortClock } from "@/lib/day";
import { clock, pad2 } from "@/lib/format";
import { planSplit, useStore } from "@/lib/store";
import type { PlannedSession } from "@/lib/types";

export default function CatchUpPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <PlannedLanding>{(p, now) => <CatchUp p={p} now={now} />}</PlannedLanding>
    </Suspense>
  );
}

/** Log a session already under way without Cadence: pick the block you're on and when you started. */
function CatchUp({ p, now }: { p: PlannedSession; now: number }) {
  const { task, live, beginSession } = useStore();
  const router = useRouter();
  const [current, setCurrent] = useState(0);
  const [since, setSince] = useState(() => hhmm(new Date(p.starts_at)));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // "Working since" is on the planned day, clamped to [starts_at, now].
  const typed = atTime(new Date(p.starts_at), since || "00:00").getTime();
  const sinceMs = Math.min(now, Math.max(Date.parse(p.starts_at), typed));
  const elapsed = Math.max(0, (now - sinceMs) / 1000);

  const track = async () => {
    setBusy(true);
    const split = planSplit(p, task);
    const [chosen] = split.splice(current, 1);
    const err = await beginSession([chosen, ...split], { planned: p, startedAt: new Date(sinceMs).toISOString() });
    setBusy(false);
    if (err) setMsg(err);
    else router.push("/session");
  };

  return (
    <div className="phone-page">
      <span className="card-kicker">Catch up · {clockTime(p.starts_at)} session</span>
      <h1 className="phone-title">What are you on right now?</h1>
      <div role="radiogroup" aria-label="Current block" className="stack-sm">
        {p.plan.map((item, i) => (
          <label key={i} className="opt">
            <input type="radio" name="current" checked={current === i} onChange={() => setCurrent(i)} />
            <span>{task(item.task_id)?.title ?? item.task_title}</span>
            <span className="text-muted xsmall">
              Block {pad2(i + 1)} · {item.minutes} min
            </span>
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="since">Working since</label>
        <input id="since" className="input" type="time" value={since} onChange={(e) => setSince(e.target.value)} style={{ minHeight: 44 }} />
        <p className="text-muted xsmall" style={{ margin: "var(--space-1) 0 0" }}>
          The timer starts at {clock(elapsed)} elapsed. Hard stop stays {shortClock(p.ends_at)}.
          {Math.abs(typed - sinceMs) >= 6e4 ? ` Times outside ${shortClock(p.starts_at)} to now are clamped.` : ""}
        </p>
      </div>
      {live && <p className="text-muted small" style={{ margin: 0 }}>Another session is running, so this one can&apos;t start.</p>}
      {msg && <p className="small" style={{ margin: 0, color: "var(--color-accent-700)" }}>{msg}</p>}
      <button className="btn btn-go btn-block-phone" onClick={track} disabled={busy || Boolean(live) || !p.plan.length}>
        Track from {shortClock(new Date(sinceMs))}
      </button>
    </div>
  );
}
