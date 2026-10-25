import type { SupabaseClient } from "@supabase/supabase-js";
import { businessDaysFromNow } from "./dates";
import { TOUCH_TYPES } from "./campaign-scope";
import { CHANNEL_LABELS, channelSupportsAction, isContactChannel } from "./people";

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
): Promise<{ taskCreated: string | null; statusSuggestion: string | null; campaignId: string; warnings: string[] }> {
  if (!opts.campaignId) throw new Error("Choose a campaign before logging outreach.");
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) throw new Error("Please sign in again.");
  const userId = userData.user.id;
  const followupDays = opts.followupDays ?? 3;
  const { data: membership, error: membershipError } = await supabase.from("campaign_leads")
    .select("id, status, touch_count, campaigns!campaign_leads_campaign_id_fkey(default_channel)").eq("campaign_id", opts.campaignId)
    .eq("lead_id", opts.leadId).single();
  if (membershipError || !membership) throw new Error("This lead is not in the selected campaign.");
  const campaign = membership.campaigns as unknown as { default_channel: string | null } | null;
  const channel = campaign?.default_channel || opts.channel || null;
  if (channel !== null && !isContactChannel(channel)) throw new Error("Choose a valid outreach channel.");
  if (!channelSupportsAction(channel, opts.action)) throw new Error(`That action is not available through ${CHANNEL_LABELS[channel!]}. Choose a matching channel in campaign settings.`);
  if (opts.personId) {
    const { error } = await supabase.from("decision_makers").select("id")
      .eq("id", opts.personId).eq("lead_id", opts.leadId).single();
    if (error) throw new Error("Choose a person linked to this lead.");
  }

  const { error: actErr } = await supabase.from("activities").insert({
    user_id: userId,
    lead_id: opts.leadId,
    campaign_id: opts.campaignId,
    type: opts.action,
    content: opts.note || null,
    channel,
    person_id: opts.personId || null,
  });
  if (actErr) throw actErr;

  // Once the activity exists, report secondary failures without inviting a
  // retry that would log the same outreach twice.
  const warnings: string[] = [];
  let taskCreated: string | null = null;
  const task = autoTask(opts.action, followupDays);
  if (task) {
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      lead_id: opts.leadId,
      campaign_id: opts.campaignId,
      ...task,
    });
    if (error) warnings.push("Outreach saved, but the follow-up task could not be created. Add one manually.");
    else taskCreated = task.title;
  }

  // touch count + last contacted on campaign_leads
  if (TOUCH_TYPES.includes(opts.action)) {
    let updated = false;
    // Compare-and-swap prevents two simultaneous logs from losing a touch.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: cl, error: readError } = await supabase.from("campaign_leads")
        .select("id, touch_count, last_contacted_at").eq("id", membership.id).single();
      if (readError || !cl) break;
      const now = new Date().toISOString();
      const { data: changed, error } = await supabase.from("campaign_leads")
        .update({ touch_count: cl.touch_count + 1, last_contacted_at: cl.last_contacted_at && cl.last_contacted_at > now ? cl.last_contacted_at : now })
        .eq("id", cl.id).eq("campaign_id", opts.campaignId).eq("lead_id", opts.leadId)
        .eq("touch_count", cl.touch_count).select("id");
      if (error) break;
      if (changed?.length) { updated = true; break; }
    }
    if (!updated) warnings.push("Outreach saved, but the campaign touch counter could not be refreshed.");
  }

  // status suggestion
  let statusSuggestion: string | null = null;
  const rule = STATUS_SUGGESTION[opts.action];
  if (opts.campaignId && rule) {
    if (rule.from.includes(membership.status)) statusSuggestion = rule.to;
  }

  return { taskCreated, statusSuggestion, campaignId: opts.campaignId, warnings };
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
