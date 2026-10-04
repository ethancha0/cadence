// Demo data for local mode (from the design prototype), dated relative to today.
import { isoDate, startOfDay } from "./format";
import type { Block, Category, Note, Priority, Session, Snapshot, Task } from "./types";

const uid = () => crypto.randomUUID();

export function seedSnapshot(): Snapshot {
  const today = startOfDay();
  const day = (offset: number, hour = 0, min = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, min);
    return d;
  };
  const created = day(-14).toISOString();

  const catNames = ["Classwork", "ZotMeet", "Tomo no Kai", "Bass Guitar", "Personal Projects"];
  const categories: Category[] = catNames.map((name, position) => ({ id: uid(), name, position, archived: false, created_at: created }));
  const [classwork, zotmeet, tomo, bass, personal] = categories.map((c) => c.id);

  const t = (category_id: string, title: string, due: number | null, priority: Priority): Task => ({
    id: uid(), category_id, title, priority, due_date: due == null ? null : isoDate(day(due)), done_at: null, created_at: created, updated_at: created,
  });
  const tasks: Task[] = [
    t(classwork, "ICS 46 · Problem set 4", 2, "high"),
    t(classwork, "PSYCH 7A · Ch. 7 reading response", 4, "medium"),
    t(classwork, "STATS 67 · Midterm review sheet", 9, "low"),
    t(zotmeet, "Fix timezone offset in availability grid", 1, "high"),
    t(zotmeet, "Review PR #112, Google Calendar sync", 3, "medium"),
    t(tomo, "Draft agenda for Wednesday board meeting", 3, "high"),
    t(tomo, "Email venue about Fall Festival date", 5, "medium"),
    t(bass, "Walking line in F at 90 bpm", null, "medium"),
    t(bass, 'Learn the "Cissy Strut" groove', null, "low"),
    t(personal, "Portfolio: write ZotMeet case study", 12, "medium"),
    t(personal, "Set up home-lab Raspberry Pi", null, "low"),
  ];

  const sessions: Session[] = [];
  const blocks: Block[] = [];
  const session = (offset: number, parts: [string, string, number][], pro: string | null, delta: string | null) => {
    const start = day(offset, 19);
    const s: Session = { id: uid(), planned_minutes: parts.reduce((a, p) => a + p[2], 0), started_at: start.toISOString(), ended_at: null, pro, delta };
    let at = start.getTime();
    const made = parts.map(([category_id, task_title, minutes], position): Block => {
      const b: Block = {
        id: uid(), session_id: s.id, task_id: null, task_title, category_id, position, planned_minutes: minutes, suggested_minutes: minutes,
        spent_seconds: minutes * 60, started_at: new Date(at).toISOString(), resumed_at: null, ended_at: new Date(at + minutes * 6e4).toISOString(), quick_notes: [],
      };
      at += minutes * 6e4;
      return b;
    });
    s.ended_at = new Date(at).toISOString();
    sessions.push(s);
    blocks.push(...made);
    return made;
  };
  const [b1, b2] = session(-1, [[classwork, "ICS 46 · Problem set 3", 60], [zotmeet, "Timezone bug triage", 30]],
    "Starting with the closest deadline took the pressure off.", "Classwork ran long again and ZotMeet only got what was left.");
  const [b3] = session(-6, [[tomo, "Treasurer sync", 45]], null, null);
  const [b4] = session(-9, [[bass, "Walking line in F", 30]], null, null);
  const [b5] = session(-12, [[personal, "Portfolio layout", 40]], null, null);
  sessions.reverse(); // newest first

  const n = (category_id: string, block: Block | null, offset: number, pro: string | null, delta: string | null, pinned = false): Note => ({
    id: uid(), category_id, task_id: null, task_title: block?.task_title ?? "", block_id: block?.id ?? null, pro, delta, pinned,
    source: block ? "block_end" : "manual", created_at: block?.ended_at ?? day(offset, 20).toISOString(),
  });
  const notes: Note[] = [
    n(classwork, b1, -1, "Wrote out the recurrence before coding; Q2 took half the time.", "Opened Discord mid-problem and lost 20 minutes. Phone goes in the other room."),
    n(zotmeet, b2, -1, "Reproduced the timezone bug with a failing test first.", "Stopped without pushing the WIP branch. Leave a handoff comment before switching."),
    n(classwork, null, -8, null, "Read the rubric before starting any write-up.", true),
    n(tomo, b3, -6, "Got the treasurer’s numbers early, so the agenda came together fast.", "The venue email sat in drafts for a week. Send it before anything else."),
    n(tomo, null, -13, null, "Cc the president on anything budget-related.", true),
    n(bass, b4, -9, "Metronome at 80 felt locked in.", "Skipped the warm-up; left hand was tired by minute 15."),
    n(personal, b5, -12, "Sketching the layout on paper first helped.", "Got lost tweaking fonts. Cap polish at 15 minutes."),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return { categories, tasks, notes, sessions, blocks };
}
