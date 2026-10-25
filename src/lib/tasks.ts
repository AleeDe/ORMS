import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskListItem = {
  id: string; title: string; type: string; due_date: string; priority: string;
  status: string; campaign_id: string | null; assigned_to: string | null;
  completed_by: string | null;
  leads: { id: string; business_name: string } | null;
  campaigns: { name: string } | null;
};

// Tab counts must use the complete result. Otherwise older/completed tasks can
// fill the API's first page and make future work appear to be missing.
export async function fetchWorkspaceTasks(supabase: SupabaseClient, workspaceId: string, campaignId?: string) {
  const tasks: TaskListItem[] = [];
  let from = 0;
  let total: number | null = null;
  for (;;) {
    let query = supabase.from("tasks")
      .select("id, title, type, due_date, priority, status, campaign_id, assigned_to, completed_by, leads!tasks_lead_id_fkey(id, business_name), campaigns!tasks_campaign_id_fkey(name)", from === 0 ? { count: "exact" } : undefined)
      .eq("workspace_id", workspaceId);
    if (campaignId) query = query.eq("campaign_id", campaignId);
    const { data, error, count } = await query.order("due_date").order("id").range(from, from + 999);
    if (error) throw error;
    if (!data.length) return tasks;
    tasks.push(...data as unknown as TaskListItem[]);
    total = count ?? total;
    // Advance by the actual response size, including servers with a lower cap.
    from += data.length;
    if (total !== null && from >= total) return tasks;
  }
}
