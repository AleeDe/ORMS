import { format } from "date-fns";

export const SEND_TYPES = ["EMAIL_SENT", "FOLLOWUP_SENT"];
export const REPLY_TYPES = ["EMAIL_REPLY"];
export const MEETING_TYPES = ["MEETING_BOOKED"];
export const CALL_TYPES = ["CALL_ATTEMPTED", "CALL_CONNECTED"];

export type TrackerActivity = { type: string; occurred_at: string };

export type TrackerRow = {
  day: string; // yyyy-MM-dd
  dateLabel: string; // 19-May-2026
  weekday: string; // Tuesday
  sends: number;
  replies: number;
  meetings: number;
  calls: number;
  replyRate: number; // percent, 2 decimals
  window: string; // e.g. "8:05 AM – 9:30 AM"
};

function fmtTime(d: Date): string {
  return format(d, "h:mm a");
}

/** Build the per-day outreach tracker (days with any activity, newest first). */
export function buildTrackerRows(activities: TrackerActivity[]): TrackerRow[] {
  const byDay = new Map<string, { acts: TrackerActivity[] }>();
  for (const a of activities) {
    const day = a.occurred_at.slice(0, 10);
    const entry = byDay.get(day) ?? { acts: [] };
    entry.acts.push(a);
    byDay.set(day, entry);
  }

  const rows: TrackerRow[] = [];
  for (const [day, { acts }] of byDay) {
    const sends = acts.filter((a) => SEND_TYPES.includes(a.type));
    const replies = acts.filter((a) => REPLY_TYPES.includes(a.type)).length;
    const meetings = acts.filter((a) => MEETING_TYPES.includes(a.type)).length;
    const calls = acts.filter((a) => CALL_TYPES.includes(a.type)).length;
    if (!sends.length && !replies && !meetings && !calls) continue;

    let window = "—";
    if (sends.length) {
      const times = sends
        .map((a) => new Date(a.occurred_at).getTime())
        .sort((x, y) => x - y);
      const first = new Date(times[0]);
      const last = new Date(times[times.length - 1]);
      window =
        times.length === 1 || fmtTime(first) === fmtTime(last)
          ? fmtTime(first)
          : `${fmtTime(first)} – ${fmtTime(last)}`;
    }

    const d = new Date(`${day}T12:00:00`);
    rows.push({
      day,
      dateLabel: format(d, "d-MMM-yyyy"),
      weekday: format(d, "EEEE"),
      sends: sends.length,
      replies,
      meetings,
      calls,
      replyRate: sends.length ? Math.round((replies / sends.length) * 10000) / 100 : 0,
      window,
    });
  }
  return rows.sort((a, b) => (a.day < b.day ? 1 : -1));
}

export function trackerTotals(rows: TrackerRow[]) {
  const sends = rows.reduce((s, r) => s + r.sends, 0);
  const replies = rows.reduce((s, r) => s + r.replies, 0);
  const meetings = rows.reduce((s, r) => s + r.meetings, 0);
  const calls = rows.reduce((s, r) => s + r.calls, 0);
  return {
    sends,
    replies,
    meetings,
    calls,
    replyRate: sends ? Math.round((replies / sends) * 10000) / 100 : 0,
  };
}
