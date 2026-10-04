// The split algorithm. Pure, with no app imports beyond formatting, so the Phase 2
// MCP server's `suggest_split` tool can share it.
import { daysUntil, dueLabel, PRIO_RANK } from "./format";
import type { Priority } from "./types";

export interface SplitTask {
  id: string;
  category_id: string;
  title: string;
  priority: Priority;
  due_date: string | null;
}

export interface SplitContext {
  /** The previous finished session: its planned length and minutes spent per category. */
  lastSession: { planned_minutes: number; alloc: Record<string, number> } | null;
  /** Days since a block in this category last ended; null if never. */
  daysSinceTouched: (categoryId: string) => number | null;
}

export interface SplitItem<T extends SplitTask = SplitTask> {
  task: T;
  score: number;
  reason: string;
  suggested: number;
  minutes: number;
}

/**
 * Weights: deadline urgency + priority + categories shorted in the previous session
 * get a boost. Sorted by score (this is also block order).
 */
export function computeSplit<T extends SplitTask>(
  tasks: T[],
  total: number,
  ctx: SplitContext,
  overrides: Record<string, number> = {},
): SplitItem<T>[] {
  const last = ctx.lastSession;
  const lastTotal = last ? last.planned_minutes : 0;
  const scored = tasks
    .map((t) => {
      const due = daysUntil(t.due_date);
      const d = due == null ? 14 : Math.max(0, due);
      const lastMin = last ? last.alloc[t.category_id] || 0 : 0;
      const share = lastTotal ? lastMin / lastTotal : 0;
      const since = ctx.daysSinceTouched(t.category_id) ?? 14;
      const score =
        1 / (d + 1) +
        (PRIO_RANK[t.priority] - 1) * 0.04 +
        (last && !lastMin ? 0.06 : 0) -
        share * 0.05 +
        Math.min(since, 14) * 0.006;
      const lastBit = !last ? "" : lastMin ? ` · ${lastMin} of ${lastTotal} min last session` : " · no time last session";
      return { task: t, score, reason: `${dueLabel(t.due_date)} · ${t.priority} priority${lastBit}` };
    })
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];

  const sum = scored.reduce((a, s) => a + s.score, 0);
  const mins = scored.map((s) => Math.max(10, Math.round((total * s.score) / sum / 5) * 5));
  mins[0] = Math.max(10, mins[0] + total - mins.reduce((a, b) => a + b, 0));
  return scored.map((s, i) => ({ ...s, suggested: mins[i], minutes: overrides[s.task.id] ?? mins[i] }));
}
