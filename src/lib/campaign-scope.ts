import type { SupabaseClient } from "@supabase/supabase-js";

export const TOUCH_TYPES = ["EMAIL_SENT", "FOLLOWUP_SENT", "CALL_ATTEMPTED", "CALL_CONNECTED"];
export const OUTREACH_TYPES = [...TOUCH_TYPES, "EMAIL_REPLY", "VOICEMAIL", "MEETING_BOOKED", "MEETING_COMPLETED"];

export function leadHref(leadId: string, campaignId?: string | null) {
  return `/leads/${encodeURIComponent(leadId)}${campaignId ? `?campaign=${encodeURIComponent(campaignId)}` : ""}`;
}

export function campaignFromSearch(params: Pick<URLSearchParams, "get">) {
  const explicit = params.get("campaign");
  if (explicit) return explicit;
  const from = params.get("from");
  return from?.startsWith("campaign:") ? from.slice(9) || null : null;
}

export function scopeCampaign<T>(query: {
  eq(column: "campaign_id", value: string): T;
  is(column: "campaign_id", value: null): T;
}, campaignId: string | null): T {
  return campaignId ? query.eq("campaign_id", campaignId) : query.is("campaign_id", null);
}

export type LeadActivity = {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  type: string;
  channel: string | null;
  person_id: string | null;
  content: string | null;
  occurred_at: string;
  actor_id?: string | null;
  actor_name?: string | null;
  campaigns: { name: string } | null;
  decision_makers: { name: string; role: string | null } | null;
};

// Read every page so a busy campaign does not silently lose older touches.
export async function fetchLeadActivities(supabase: SupabaseClient, leadId: string, campaignId: string | null) {
  const all: LeadActivity[] = [];
  for (let from = 0; ; from += 1000) {
    const query = supabase.from("activities")
      .select("*, campaigns!activities_campaign_id_fkey(name), decision_makers!activities_person_id_fkey(name, role)").eq("lead_id", leadId);
    const { data, error } = await scopeCampaign(query, campaignId)
      .order("occurred_at", { ascending: false }).order("id").range(from, from + 999);
    if (error) throw error;
    all.push(...(data as unknown as LeadActivity[]));
    if (data.length < 1000) return all;
  }
}

export function channelTouchTotals(activities: Pick<LeadActivity, "type" | "channel" | "person_id" | "occurred_at">[]) {
  const totals = new Map<string, { channel: string; person_id: string | null; touches: number; last_touch_at: string }>();
  for (const activity of activities) {
    if (!TOUCH_TYPES.includes(activity.type)) continue;
    const channel = activity.channel || "other";
    const key = `${channel}:${activity.person_id ?? ""}`;
    const row = totals.get(key) ?? { channel, person_id: activity.person_id, touches: 0, last_touch_at: activity.occurred_at };
    row.touches++;
    if (activity.occurred_at > row.last_touch_at) row.last_touch_at = activity.occurred_at;
    totals.set(key, row);
  }
  return [...totals.values()];
}

export async function addLeadsToCampaign(supabase: SupabaseClient, campaignId: string, leadIds: string[]) {
  if (!campaignId || !leadIds.length) throw new Error("Choose a campaign and at least one lead.");
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) throw new Error("Please sign in again.");
  let added = 0;
  const unique = [...new Set(leadIds)];
  for (let from = 0; from < unique.length; from += 500) {
    const { data: inserted, error } = await supabase.from("campaign_leads").upsert(
      unique.slice(from, from + 500).map((lead_id) => ({
        user_id: data.user!.id, campaign_id: campaignId, lead_id,
        status: "new", touch_count: 0, last_contacted_at: null,
      })),
      // Re-adding a member must never reset its existing progress.
      { onConflict: "campaign_id,lead_id", ignoreDuplicates: true }
    ).select("id");
    if (error) throw error;
    added += inserted?.length ?? 0;
  }
  return added;
}

export type NextStepLead = {
  id: string; campaign_id: string | null; business_name: string;
  website: string | null; campaign_name: string | null;
};

export function missingNextSteps(
  outreach: NextStepLead[],
  tasks: { lead_id: string | null; campaign_id: string | null }[]
) {
  const key = (leadId: string, campaignId: string | null) => `${leadId}:${campaignId ?? ""}`;
  const covered = new Set(tasks.filter((t) => t.lead_id).map((t) => key(t.lead_id!, t.campaign_id)));
  const missing = new Map<string, NextStepLead>();
  for (const lead of outreach) {
    const scope = key(lead.id, lead.campaign_id);
    if (!covered.has(scope)) missing.set(scope, lead);
  }
  return [...missing.values()];
}

export async function fetchMissingNextSteps(supabase: SupabaseClient, campaignId?: string | null) {
  const outreach: NextStepLead[] = [];
  const pending: { lead_id: string | null; campaign_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from("activities")
      .select("lead_id, campaign_id, leads!activities_lead_id_fkey!inner(id, business_name, website), campaigns!activities_campaign_id_fkey(name)")
      .in("type", OUTREACH_TYPES);
    if (campaignId !== undefined) query = scopeCampaign(query, campaignId);
    const { data, error } = await query.order("id").range(from, from + 999);
    if (error) throw error;
    for (const row of data as unknown as { lead_id: string; campaign_id: string | null; leads: { id: string; business_name: string; website: string | null }; campaigns: { name: string } | null }[]) {
      outreach.push({ ...row.leads, campaign_id: row.campaign_id, campaign_name: row.campaigns?.name ?? null });
    }
    if (data.length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    let query = supabase.from("tasks").select("lead_id, campaign_id").eq("status", "pending");
    if (campaignId !== undefined) query = scopeCampaign(query, campaignId);
    const { data, error } = await query.order("id").range(from, from + 999);
    if (error) throw error;
    pending.push(...data);
    if (data.length < 1000) break;
  }
  return missingNextSteps(outreach, pending);
}
