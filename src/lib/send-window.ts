// Works out *when* an approved email should actually be delivered.
//
// The point: you review in the morning, but the emails should land inside your
// outreach window (say 1pm–2pm) because that is when replies are most likely.
// Approving is not sending — it hands Resend a delivery time.
//
// Sends are spread across the window rather than fired at once: 60 emails
// arriving in the same second looks automated, and a young domain cannot afford
// to look automated.

export type WindowSettings = {
  outreach_start_time: string; // "13:00:00"
  outreach_end_time: string; // "14:00:00"
  timezone: string; // "Europe/London"
  schedule_in_window: boolean;
};

/**
 * Offset of a named timezone from UTC at a given instant, in minutes.
 * Uses Intl rather than a date library so DST is handled by the platform.
 */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second")
  );
  return (asUTC - date.getTime()) / 60000;
}

/** A wall-clock time in `timeZone`, converted to a real instant. */
function zonedTimeToUtc(
  year: number, month: number, day: number,
  hh: number, mm: number, timeZone: string
): Date {
  const guess = Date.UTC(year, month, day, hh, mm, 0);
  // Two passes: the offset itself depends on the instant near DST boundaries.
  let d = new Date(guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000);
  d = new Date(guess - tzOffsetMinutes(d, timeZone) * 60000);
  return d;
}

function parseHM(t: string): [number, number] {
  const [h, m] = t.split(":").map(Number);
  return [h || 0, m || 0];
}

/** Today's window in `timeZone`, as real instants. */
export function windowForDate(
  date: Date,
  s: Pick<WindowSettings, "outreach_start_time" | "outreach_end_time" | "timezone">
): { start: Date; end: Date } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: s.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [y, mo, d] = dtf.format(date).split("-").map(Number);
  const [sh, sm] = parseHM(s.outreach_start_time);
  const [eh, em] = parseHM(s.outreach_end_time);

  return {
    start: zonedTimeToUtc(y, mo - 1, d, sh, sm, s.timezone),
    end: zonedTimeToUtc(y, mo - 1, d, eh, em, s.timezone),
  };
}

export type ScheduleResult = {
  /** ISO string for Resend, or null to send immediately. */
  scheduledAt: string | null;
  /** Why — shown to the user so a delayed send is never a surprise. */
  reason: "immediate" | "later-today" | "tomorrow";
};

/**
 * Picks a delivery time for the next approved email.
 *
 * `alreadyScheduled` is how many are already queued for the same window; each
 * one pushes this send further along so they arrive spread out rather than in a
 * burst.
 */
export function nextSendSlot(
  settings: WindowSettings,
  alreadyScheduled: number,
  now: Date = new Date()
): ScheduleResult {
  if (!settings.schedule_in_window) {
    return { scheduledAt: null, reason: "immediate" };
  }

  const { start, end } = windowForDate(now, settings);
  const windowMs = Math.max(0, end.getTime() - start.getTime());

  // Spread across the window, but never less than 30s apart — Resend allows 10
  // requests/second, and human-paced sending reads better than a burst.
  const spacingMs = Math.max(30_000, alreadyScheduled > 0 ? windowMs / (alreadyScheduled + 1) : 60_000);

  // Inside the window already: go now, so review-at-1pm doesn't wait a day.
  if (now >= start && now < end) {
    const slot = new Date(now.getTime() + alreadyScheduled * spacingMs);
    return slot < end
      ? { scheduledAt: null, reason: "immediate" }
      : { scheduledAt: slot.toISOString(), reason: "later-today" };
  }

  // Before the window: hold until it opens.
  if (now < start) {
    const slot = new Date(start.getTime() + alreadyScheduled * spacingMs);
    return { scheduledAt: slot.toISOString(), reason: "later-today" };
  }

  // Window has closed: first slot tomorrow.
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const t = windowForDate(tomorrow, settings);
  const slot = new Date(t.start.getTime() + alreadyScheduled * spacingMs);
  return { scheduledAt: slot.toISOString(), reason: "tomorrow" };
}

/** Human-readable delivery time in the user's own timezone. */
export function formatSlot(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString(undefined, {
    timeZone,
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
}
