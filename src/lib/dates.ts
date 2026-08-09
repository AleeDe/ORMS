import { addBusinessDays, format } from "date-fns";

export function businessDaysFromNow(days: number): string {
  return format(addBusinessDays(new Date(), days), "yyyy-MM-dd");
}

export function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * A due date as a human would say it — "Tomorrow", "Mon 11 Aug" — because a bare
 * "2026-08-10" makes the reader do the arithmetic to answer "is that soon?".
 * Both arguments are yyyy-MM-dd, so this is pure string comparison and never
 * drifts with the viewer's timezone.
 */
export function formatDueDay(day: string, today: string): string {
  if (day === today) return "Today";

  const oneDay = 24 * 60 * 60 * 1000;
  const diff = Math.round((Date.parse(day) - Date.parse(today)) / oneDay);
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";

  const label = format(new Date(`${day}T00:00:00`), "EEE d MMM");
  return diff > 1 && diff < 7 ? `${label} (in ${diff} days)` : label;
}
