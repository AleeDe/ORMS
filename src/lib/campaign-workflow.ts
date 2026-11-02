import type { SupabaseClient } from "@supabase/supabase-js";
import { canManage, canWork, type CampaignRole } from "./workspace";

export type WorkRole = "appointment_setter" | "closer" | "full_cycle";
export type WorkflowStage = "prospecting" | "qualified" | "won" | "lost";
export const WORK_ROLE_LABELS: Record<WorkRole, string> = { appointment_setter: "Appointment setter", closer: "Closer", full_cycle: "Full cycle" };
export const STAGE_LABELS: Record<WorkflowStage, string> = { prospecting: "Prospecting", qualified: "Qualified", won: "Won", lost: "Lost / not a fit" };
export type CampaignWorker = { user_id: string; label: string; access_role: CampaignRole; work_role: WorkRole };
export type WorkflowLead = {
  id: string; lead_id: string; campaign_id: string; status: string; workflow_stage: WorkflowStage;
  qualified_at: string | null; qualified_by: string | null; appointment_at: string | null;
  assigned_closer_id: string | null; closed_at: string | null; closed_by: string | null; workflow_version: number;
};
export const WORKFLOW_FIELDS = "workflow_stage, qualified_at, qualified_by, appointment_at, assigned_closer_id, closed_at, closed_by, workflow_version";
export function canSetAppointment(access: CampaignRole | null, job?: WorkRole | null) {
  return canManage(access) || (canWork(access) && (job === "appointment_setter" || job === "full_cycle"));
}
export function canCloseLead(access: CampaignRole | null, job: WorkRole | null | undefined, lead: Pick<WorkflowLead, "workflow_stage" | "assigned_closer_id">, user: string) {
  return lead.workflow_stage === "qualified" && (canManage(access) || (canWork(access) && (job === "closer" || job === "full_cycle") && (!lead.assigned_closer_id || lead.assigned_closer_id === user)));
}
export function workflowStatusAllowed(status: string, access: CampaignRole | null, job: WorkRole | null | undefined, lead: Pick<WorkflowLead, "workflow_stage" | "assigned_closer_id">, user: string) {
  if (!canWork(access)) return false;
  if (canManage(access)) return true;
  if (["won", "lost"].includes(lead.workflow_stage)) return false;
  if (status === "interested_meeting") return canSetAppointment(access, job);
  if (status === "won" || (["lost", "no_fit"].includes(status) && lead.workflow_stage === "qualified")) return canCloseLead(access, job, lead, user);
  return true;
}
export async function fetchCampaignTeam(supabase: SupabaseClient, campaign: string) {
  const { data, error } = await supabase.rpc("orms_campaign_team", { p_campaign: campaign });
  // Existing databases can keep serving the previous campaign UI until the
  // reviewed migration is applied. A permissions/network error stays visible.
  if (error && ["PGRST202", "42883"].includes(error.code)) return { available: false, members: [] as CampaignWorker[] };
  if (error) throw error;
  return { available: true, members: data as CampaignWorker[] };
}
export type WorkflowIntent = {
  campaign: string; lead: string; action: "qualify" | "book" | "assign" | "claim" | "won" | "lost" | "reopen";
  requestId: string; version: number; appointment?: string | null; closer?: string | null; note?: string;
};
export async function runWorkflowAction(supabase: SupabaseClient, intent: WorkflowIntent) {
  if (!intent.campaign || !intent.lead) throw Error("Choose a lead in a campaign.");
  if (intent.action === "book" && (!intent.appointment || !Number.isFinite(Date.parse(intent.appointment)))) throw Error("Choose an appointment date and time.");
  const { data, error } = await supabase.rpc("orms_campaign_lead_action", {
    p_campaign: intent.campaign, p_lead: intent.lead, p_action: intent.action, p_request_id: intent.requestId,
    p_version: intent.version, p_appointment_at: intent.appointment ?? null, p_closer: intent.closer ?? null, p_note: intent.note?.trim() || null,
  });
  if (error) throw error;
  return data as WorkflowLead;
}

export type PerformanceMetrics = { touches: number; replies: number; qualified: number; appointments: number; won: number; lost: number; disqualified: number; completed_tasks: number; pending_tasks: number; overdue_tasks: number };
export type CampaignPerformance = {
  from: string | null; to: string | null; timezone: string; as_of: string;
  totals: PerformanceMetrics & { leads: number; qualified_queue: number; unassigned_qualified: number };
  campaigns: (PerformanceMetrics & { id: string; name: string; leads: number; prospecting: number; qualified_queue: number; unassigned_qualified: number; current_won: number; current_lost: number })[];
  members: (PerformanceMetrics & { campaign_id: string; campaign_name: string; actor_key: string; label: string; work_role: WorkRole | "historical"; access_role: CampaignRole | null })[];
};
export function metricNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
export async function fetchAnalyticsActivities(supabase: SupabaseClient, since: string, campaignId?: string) {
  const rows: { id: string; type: string; occurred_at: string; campaign_id: string | null }[] = [];
  let total: number | null = null;
  for (let from = 0; ;) {
    let query = supabase.from("activities").select("id, type, occurred_at, campaign_id", from === 0 ? { count: "exact" } : undefined).gte("occurred_at", since);
    if (campaignId) query = query.eq("campaign_id", campaignId);
    const { data, count, error } = await query.order("occurred_at").order("id").range(from, from + 999);
    if (error) throw error;
    if (!data.length) return rows;
    rows.push(...data); total = count ?? total; from += data.length;
    if (total !== null && from >= total) return rows;
  }
}
export function memberPerformanceTotals(rows: CampaignPerformance["members"]) {
  const totals = new Map<string, PerformanceMetrics & { actor_key: string; label: string; campaigns: number }>();
  const keys = ["touches", "replies", "qualified", "appointments", "won", "lost", "disqualified", "completed_tasks", "pending_tasks", "overdue_tasks"] as const;
  for (const row of rows) {
    const total = totals.get(row.actor_key) ?? { actor_key: row.actor_key, label: row.label, campaigns: 0, touches: 0, replies: 0, qualified: 0, appointments: 0, won: 0, lost: 0, disqualified: 0, completed_tasks: 0, pending_tasks: 0, overdue_tasks: 0 };
    total.campaigns++; for (const key of keys) total[key] += metricNumber(row[key]);
    totals.set(row.actor_key, total);
  }
  return [...totals.values()].sort((a, b) => a.label.localeCompare(b.label));
}
export function performanceCsv(report: CampaignPerformance) {
  const columns = ["campaign_name", "label", "work_role", "touches", "replies", "qualified", "appointments", "won", "lost", "disqualified", "completed_tasks", "pending_tasks", "overdue_tasks"] as const;
  const cell = (value: unknown) => {
    // Spreadsheet formula prefixes must stay plain text in exported labels.
    let text = String(value ?? ""); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns.map(cell).join(","), ...report.members.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n");
}
