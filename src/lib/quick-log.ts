import { SupabaseClient } from "@supabase/supabase-js";
import { businessDaysFromNow } from "./dates";

export type QuickLogAction =
  | "EMAIL_SENT"
  | "FOLLOWUP_SENT"
  | "EMAIL_REPLY"
  | "CALL_ATTEMPTED"
  | "CALL_CONNECTED"
  | "MEETING_BOOKED";

export const QUICK_LOG_LABELS: Record<QuickLogAction, string> = {
  EMAIL_SENT: "Email Sent",
  FOLLOWUP_SENT: "Follow-up Sent",
  EMAIL_REPLY: "Reply",
  CALL_ATTEMPTED: "Call (no connect)",
  CALL_CONNECTED: "Call Connected",
  MEETING_BOOKED: "Meeting Booked",
};

// PRD §12.4: suggested status advance per event (one-tap confirm, never silent)
export const STATUS_SUGGESTION: Partial<Record<QuickLogAction, { from: string[]; to: string }>> = {
  EMAIL_SENT: { from: ["new"], to: "contacted" },
  FOLLOWUP_SENT: { from: ["new", "contacted"], to: "following_up" },
  EMAIL_REPLY: { from: ["new", "contacted", "following_up"], to: "replied" },
  MEETING_BOOKED: { from: ["new", "contacted", "following_up", "replied"], to: "interested_meeting" },
};

const TOUCH_EVENTS: QuickLogAction[] = [
  "EMAIL_SENT", "FOLLOWUP_SENT", "CALL_ATTEMPTED", "CALL_CONNECTED",
];

// PRD §12.2 auto-task rules
function autoTask(
  action: QuickLogAction,
  followupDays: number
): { type: string; title: string; due_date: string } | null {
  switch (action) {
    case "EMAIL_SENT":
    case "FOLLOWUP_SENT":
      return {
        type: "followup_email",
        title: "Follow up on email",
        due_date: businessDaysFromNow(followupDays),
      };
    case "CALL_ATTEMPTED":
      return {
        type: "call_lead",
        title: "Retry call",
        due_date: businessDaysFromNow(1),
      };
    case "MEETING_BOOKED":
      return {
        type: "meeting_reminder",
        title: "Prepare for meeting",
        due_date: businessDaysFromNow(1),
      };
    default:
      return null; // Reply: user sets next action
  }
}

export async function quickLog(
  supabase: SupabaseClient,
  opts: {
    leadId: string;
    campaignId: string | null;
    action: QuickLogAction;
    note?: string;
    followupDays?: number;
    /** How the lead was contacted — drives per-channel touch counts */
    channel?: string | null;
    /** Which person at the lead was contacted */
    personId?: string | null;
  }
): Promise<{ taskCreated: string | null; statusSuggestion: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id;
  const followupDays = opts.followupDays ?? 3;

  const { error: actErr } = await supabase.from("activities").insert({
    user_id: userId,
    lead_id: opts.leadId,
    campaign_id: opts.campaignId,
    type: opts.action,
    content: opts.note || null,
    channel: opts.channel || null,
    person_id: opts.personId || null,
  });
  if (actErr) throw actErr;

  // auto-task
  const task = autoTask(opts.action, followupDays);
  if (task) {
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      lead_id: opts.leadId,
      campaign_id: opts.campaignId,
      ...task,
    });
    if (error) throw error;
  }

  // touch count + last contacted on campaign_leads
  if (opts.campaignId && TOUCH_EVENTS.includes(opts.action)) {
    const { data: cl } = await supabase
      .from("campaign_leads")
      .select("id, touch_count")
      .eq("campaign_id", opts.campaignId)
      .eq("lead_id", opts.leadId)
      .maybeSingle();
    if (cl) {
      await supabase
        .from("campaign_leads")
        .update({ touch_count: cl.touch_count + 1, last_contacted_at: new Date().toISOString() })
        .eq("id", cl.id);
    }
  }

  // status suggestion
  let statusSuggestion: string | null = null;
  const rule = STATUS_SUGGESTION[opts.action];
  if (opts.campaignId && rule) {
    const { data: cl } = await supabase
      .from("campaign_leads")
      .select("status")
      .eq("campaign_id", opts.campaignId)
      .eq("lead_id", opts.leadId)
      .maybeSingle();
    if (cl && rule.from.includes(cl.status)) statusSuggestion = rule.to;
  }

  return { taskCreated: task?.title ?? null, statusSuggestion };
}

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  following_up: "Following Up",
  replied: "Replied",
  interested_meeting: "Interested / Meeting",
  won: "Won",
  lost: "Lost",
  no_fit: "No Fit / No Response",
};

export const STATUS_ORDER = [
  "new", "contacted", "following_up", "replied", "interested_meeting", "won", "lost", "no_fit",
];
