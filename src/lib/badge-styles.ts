// Semantic badge/pill colors used across the app so a "won" is always green,
// "overdue" always red, etc. Each returns Tailwind classes for a soft, theme-aware
// pill (light bg + readable text in both light and dark mode).

const TONE: Record<string, string> = {
  green:
    "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300 border-transparent",
  amber:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 border-transparent",
  red:
    "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300 border-transparent",
  blue:
    "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 border-transparent",
  violet:
    "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300 border-transparent",
  slate:
    "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-transparent",
};

export type Tone = keyof typeof TONE;

export const toneClass = (tone: Tone) => TONE[tone];

// Campaign lead status → tone
const STATUS_TONE: Record<string, Tone> = {
  new: "slate",
  contacted: "blue",
  following_up: "amber",
  replied: "violet",
  interested_meeting: "violet",
  won: "green",
  lost: "red",
  no_fit: "slate",
};
export const statusTone = (status: string): Tone => STATUS_TONE[status] ?? "slate";
export const statusClass = (status: string) => toneClass(statusTone(status));

// Task priority → tone
const PRIORITY_TONE: Record<string, Tone> = {
  high: "red",
  medium: "amber",
  low: "slate",
};
export const priorityClass = (priority: string) => toneClass(PRIORITY_TONE[priority] ?? "slate");

// Activity type → tone (timeline icons / badges)
const ACTIVITY_TONE: Record<string, Tone> = {
  EMAIL_SENT: "blue",
  FOLLOWUP_SENT: "blue",
  EMAIL_REPLY: "green",
  CALL_ATTEMPTED: "amber",
  CALL_CONNECTED: "green",
  VOICEMAIL: "amber",
  MEETING_BOOKED: "violet",
  MEETING_COMPLETED: "green",
  NOTE_ADDED: "slate",
  STATUS_CHANGED: "slate",
  INFO_UPDATED: "slate",
};
export const activityTone = (type: string): Tone => ACTIVITY_TONE[type] ?? "slate";
export const activityClass = (type: string) => toneClass(activityTone(type));

// Due-date urgency → tone (relative to today's ISO date string)
export function dueTone(dueDate: string, today: string, done = false): Tone {
  if (done) return "green";
  if (dueDate < today) return "red";
  if (dueDate === today) return "amber";
  return "slate";
}
