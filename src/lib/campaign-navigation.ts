import type { SupabaseClient } from "@supabase/supabase-js";

export type CampaignLeadPosition = { id: string; lead_id: string; added_at: string };

export async function fetchCampaignLeadOrder(supabase: SupabaseClient, campaignId: string) {
  const rows: CampaignLeadPosition[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("campaign_leads")
      .select("id, lead_id, added_at").eq("campaign_id", campaignId)
      .order("added_at", { ascending: false }).order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export function campaignNeighbors(rows: Pick<CampaignLeadPosition, "lead_id">[], leadId: string) {
  const index = rows.findIndex((row) => row.lead_id === leadId);
  return {
    index, total: rows.length,
    previous: index > 0 ? rows[index - 1].lead_id : null,
    next: index >= 0 && index < rows.length - 1 ? rows[index + 1].lead_id : null,
  };
}

export function leadShortcut(event: {
  key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean;
  shiftKey: boolean; repeat: boolean; isComposing: boolean; defaultPrevented: boolean;
}) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing || event.defaultPrevented) return null;
  const key = event.key.toLowerCase();
  return key === "n" ? "next" : key === "p" ? "previous" : null;
}
