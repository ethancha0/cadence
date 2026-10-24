"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { clockTime, displayStatus, timeRange } from "@/lib/day";
import { useNow, useStore } from "@/lib/store";
import type { PlannedSession } from "@/lib/types";

/**
 * Shell for the pages reminder links open (/session/start, /catch-up, /skip): finds the planned
 * session from `?planned=`, and when it's no longer `planned`, says what happened instead of `children`.
 * Opening one of these never changes anything by itself.
 */
export function PlannedLanding({ children }: { children: (p: PlannedSession, now: number) => ReactNode }) {
  const { ready, data, live, sessions } = useStore();
  const id = useSearchParams().get("planned");
  const now = useNow(true, 15_000);

  if (!ready) return <p className="text-muted">Loading…</p>;
  const p = data.planned.find((x) => x.id === id);
  if (!p) {
    return (
      <Gone title="This session isn't on your week">
        It may have been removed. <Link href="/week">Open your week</Link> to plan another.
      </Gone>
    );
  }

  const status = displayStatus(p, new Date(now));
  if (status === "planned") return <>{children(p, now)}</>;

  const session = sessions.find((s) => s.id === p.session_id);
  const running = live && live.session.id === p.session_id;
  const next = running ? <Link href="/session">Go to the session</Link> : <Link href="/week">Open your week</Link>;
  const title =
    status === "started"
      ? `Already started${session ? ` at ${clockTime(session.started_at)}` : ""}`
      : status === "caught_up"
        ? `Already logged${session ? `, from ${clockTime(session.started_at)}` : ""}`
        : status === "skipped"
          ? `Skipped${p.skip_reason ? `: ${p.skip_reason}` : ""}`
          : "This window has ended";
  return (
    <Gone title={title} kicker={timeRange(p.starts_at, p.ends_at)}>
      {status === "missed" ? <>Nothing was started before its {clockTime(p.ends_at)} hard stop. </> : null}
      {next}.
    </Gone>
  );
}

function Gone({ title, kicker, children }: { title: string; kicker?: string; children: ReactNode }) {
  return (
    <div className="phone-page">
      {kicker && <span className="card-kicker">{kicker}</span>}
      <h1 className="phone-title">{title}</h1>
      <p className="text-muted" style={{ margin: 0 }}>
        {children}
      </p>
    </div>
  );
}
