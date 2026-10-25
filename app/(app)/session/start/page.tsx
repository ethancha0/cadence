"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { PinnedLines, ProDelta } from "@/components/notes";
import { PlannedLanding } from "@/components/PlannedLanding";
import { clockTime, holdsTime, lenLabel, sameDay, timeRange } from "@/lib/day";
import { pad2 } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { PlannedSession } from "@/lib/types";

const MIN = 6e4;

export default function StartPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <PlannedLanding>{(p, now) => <Start p={p} now={now} />}</PlannedLanding>
    </Suspense>
  );
}

function Start({ p, now }: { p: PlannedSession; now: number }) {
  const { data, live, catName, lastNote, pinnedFor, beginSession, splitFor, planFromBlock } = useStore();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startsIn = Math.round((Date.parse(p.starts_at) - now) / MIN);
  const left = Math.floor((Date.parse(p.ends_at) - now) / MIN);
  const split = splitFor(p, now);
  const planned = split.reduce((a, i) => a + i.minutes, 0);
  const span = (m: number) => (m >= 60 ? lenLabel(m) : `${m}\u00a0minute${m === 1 ? "" : "s"}`);
  const title = startsIn > 0 ? `Your session starts in ${span(startsIn)}.` : startsIn === 0 ? "Your session starts now." : `Your session started ${span(-startsIn)} ago.`;
  const later = data.planned.find((x) => x.id !== p.id && holdsTime(x) && x.status === "planned" && sameDay(x.starts_at, new Date(now)) && x.starts_at > p.starts_at);

  // Opening this page never starts anything: only the button does.
  const start = async () => {
    setBusy(true);
    const err = await beginSession(split, { planned: p });
    setBusy(false);
    if (err) setMsg(err);
    else router.push("/session");
  };

  return (
    <div className="start-page">
      <header className="stack-sm">
        <span className="card-kicker">Planned · {timeRange(p.starts_at, p.ends_at)}</span>
        <h1 className="start-title">{title}</h1>
        <p className="text-muted" style={{ margin: 0, fontSize: 16 }}>
          The plan is ready. Read your notes, then start.{" "}
          {p.until_label ? `The hard stop at ${clockTime(p.ends_at)} gets you to ${p.until_label} on time.` : `The hard stop is your ${clockTime(p.ends_at)} wind-down.`}
          {left < planned && left >= 15 ? ` Starting now fits the blocks into the ${left} minutes left.` : ""}
        </p>
      </header>

      <section aria-label="Blocks">
        {split.map((item, i) => {
          const note = lastNote(item.task.category_id);
          return (
            <div key={i} className="start-block">
              <span className="order-num">{pad2(i + 1)}</span>
              <div className="stack-sm" style={{ minWidth: 0 }}>
                <span className="split-title" style={{ fontSize: 21 }}>
                  {item.task.title}
                </span>
                <span className="pd-label" style={{ margin: 0 }}>
                  {catName(item.task.category_id)} · last time
                </span>
                {note ? <ProDelta note={note} /> : <p className="text-muted small" style={{ margin: 0 }}>No notes yet for this category.</p>}
                <PinnedLines notes={pinnedFor(item.task.category_id)} />
              </div>
              <span className="mins">
                {item.minutes}
                <small> min</small>
              </span>
            </div>
          );
        })}
        {!split.length && (
          <p className="text-muted">
            No open tasks in {p.category_id ? catName(p.category_id) : "this session"}. <Link href="/tasks">Add one on Tasks</Link>.
          </p>
        )}
      </section>

      <div className="stack-sm" style={{ alignItems: "flex-start", gap: "var(--space-3)" }}>
        <button className="btn btn-go" onClick={start} disabled={busy || Boolean(live) || left < 15 || !split.length}>
          <Play size={16} fill="currentColor" />
          Start session
        </button>
        {live && (
          <p className="text-muted small" style={{ margin: 0 }}>
            Another session is running. <Link href="/session">Go to it</Link>.
          </p>
        )}
        {left < 15 && (
          <p className="small" style={{ margin: 0, color: "var(--color-accent-700)" }}>
            This window is over: less than 15 minutes are left before its hard stop.
          </p>
        )}
        {msg && <p className="small" style={{ margin: 0, color: "var(--color-accent-700)" }}>{msg}</p>}
        <div className="link-row">
          <Link href={`/session/catch-up?planned=${p.id}`}>Already working? Log it</Link>
          <Link href="/" onClick={() => planFromBlock(p)}>
            Swap a task
          </Link>
          <Link href={`/session/skip?planned=${p.id}`}>Skip this one</Link>
        </div>
      </div>

      {later && (
        <section aria-label="Later today" className="start-later">
          <span className="card-kicker" style={{ color: "var(--color-neutral-800)" }}>Later today</span>
          <span className="card-title" style={{ fontSize: 20 }}>
            {later.label || (later.category_id ? catName(later.category_id) : "Session")} · {timeRange(later.starts_at, later.ends_at)}
          </span>
          <span className="text-muted small">{splitFor(later, now).map((i) => i.task.title).join(", ")}</span>
        </section>
      )}
    </div>
  );
}
