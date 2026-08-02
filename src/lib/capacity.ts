import { SupabaseClient } from "@supabase/supabase-js";

// Sending capacity: how much may go out today, and how it splits.
//
// The rule that drives everything: follow-ups are served before new leads. A
// follow-up is time-sensitive (the lead is mid-conversation); a new lead can
// wait a day. Left unmanaged, follow-ups compound until they consume the whole
// budget — with a 3-step sequence, steady-state new leads settle at roughly
// cap ÷ steps, so a 100/day cap means ~33 new leads/day, not 100.

export type Capacity = {
  cap: number;
  /** Which limit actually bound, so the UI can explain the number. */
  cap_source: "warmup" | "provider" | "target" | "default";
  used_today: number;
  used_month: number;
  monthly_limit: number | null;
  remaining: number;
  followups_due: number;
  new_due: number;
  followups_sent: number;
  new_sent: number;
  warmup_week: number;
  warmup_weeks_left: number;
  warmup_active: boolean;
};

export type ForecastDay = {
  day: string;
  followups: number;
  new_leads: number;
  total: number;
};

export async function getCapacity(supabase: SupabaseClient): Promise<Capacity> {
  const { data, error } = await supabase.rpc("sending_capacity_today");
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as Capacity;
}

export async function getForecast(
  supabase: SupabaseClient,
  days = 7
): Promise<ForecastDay[]> {
  const { data, error } = await supabase.rpc("sending_forecast", { p_days: days });
  if (error) throw error;
  return (data ?? []) as ForecastDay[];
}

/** Clears today's follow-ups so the full budget goes to new leads. */
export async function deferFollowupsToday(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("defer_followups_today");
  if (error) throw error;
  return (data as number) ?? 0;
}

/**
 * How the remaining budget divides. Follow-ups are allocated first, so the
 * number of new leads that can go out today is whatever survives.
 */
export function splitRemaining(c: Capacity) {
  const followupSlots = Math.min(c.followups_due, c.remaining);
  const newSlots = Math.max(0, c.remaining - followupSlots);
  return {
    followupSlots,
    newSlots,
    // True when follow-ups alone exhaust the day — the case worth warning about.
    followupsBlockNew: c.followups_due >= c.remaining && c.new_due > 0,
  };
}

const WARMUP_CURVE = [15, 30, 50, 80, 100];

/** Plain-language explanation of why today's cap is what it is. */
export function explainCap(c: Capacity): string {
  switch (c.cap_source) {
    case "warmup":
      return `Warming up — week ${c.warmup_week} of ${WARMUP_CURVE.length}. Sending slowly protects a new domain's reputation.`;
    case "provider":
      return "This is your email provider's daily limit.";
    case "target":
      return "This is the daily target you set.";
    default:
      return "Default daily limit.";
  }
}

/** The week-by-week ramp, for showing the user what comes next. */
export function warmupSchedule(currentWeek: number) {
  return WARMUP_CURVE.map((limit, i) => ({
    week: i + 1,
    limit,
    state:
      i + 1 < currentWeek ? ("done" as const)
      : i + 1 === currentWeek ? ("current" as const)
      : ("upcoming" as const),
  }));
}

/** Date the ramp finishes, so the UI can say "full speed from 18 August". */
export function fullSpeedDate(weeksLeft: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + weeksLeft * 7);
  return d;
}

/**
 * Steady-state new leads per day once follow-ups are compounding. This is the
 * number people are surprised by: a 3-step sequence at 100/day sustains ~33 new
 * leads/day, not 100.
 */
export function steadyStateNewPerDay(cap: number, stepsPerSequence: number): number {
  if (stepsPerSequence < 1) return cap;
  return Math.floor(cap / stepsPerSequence);
}

/** Working days to get through a list at the steady-state rate. */
export function daysToClear(
  leads: number,
  cap: number,
  stepsPerSequence: number
): number {
  const perDay = steadyStateNewPerDay(cap, stepsPerSequence);
  return perDay > 0 ? Math.ceil(leads / perDay) : Infinity;
}
