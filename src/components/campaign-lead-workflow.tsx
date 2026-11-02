"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, Handshake, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace, useWorkspaceClient, useWorkspaceDraft } from "@/components/workspace-provider";
import { useCampaignTeam } from "@/hooks/use-campaign-team";
import { canManage, canWork } from "@/lib/workspace";
import { canCloseLead, canSetAppointment, runWorkflowAction, STAGE_LABELS, WORKFLOW_FIELDS, WORK_ROLE_LABELS, type WorkflowIntent, type WorkflowLead } from "@/lib/campaign-workflow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function useCampaignLeadWorkflow(campaignId: string | null, leadId: string) {
  const supabase = useWorkspaceClient(), team = useCampaignTeam(campaignId);
  return useQuery({ queryKey: ["campaign-workflow", campaignId, leadId], enabled: !!campaignId && team.data?.available === true,
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_leads").select(`id, campaign_id, lead_id, status, ${WORKFLOW_FIELDS}`).eq("campaign_id", campaignId!).eq("lead_id", leadId).single();
      if (error) throw error; return data as WorkflowLead;
    } });
}
export function CampaignLeadWorkflow({ campaignId, leadId }: { campaignId: string; leadId: string }) {
  const access = useWorkspace(), supabase = useWorkspaceClient(), client = useQueryClient();
  const team = useCampaignTeam(campaignId), workflow = useCampaignLeadWorkflow(campaignId, leadId);
  const [note, setNote] = useState(""), [closer, setCloser] = useState<string | null>(null);
  const [failed, setFailed] = useState<WorkflowIntent | null>(null);
  const role = access.role(campaignId), job = team.data?.members.find(member => member.user_id === access.userId)?.work_role;
  const lead = workflow.data;
  function refresh() {
    for (const key of ["campaign-workflow", "campaign-leads", "campaign-stats", "campaign-performance", "activities", "lead", "campaigns", "analytics-campaigns", "analytics-activities", "team-data", "tasks", "lead-tasks", "notification-feed"]) client.invalidateQueries({ queryKey: [key] });
  }
  const save = useMutation({ mutationFn: (intent: WorkflowIntent) => runWorkflowAction(supabase, intent),
    onSuccess: (_data, intent) => { setNote(""); setCloser(null); setFailed(null); refresh(); toast.success(intent.action === "qualify" ? "Lead moved to Qualified" : intent.action === "claim" ? "Lead assigned to you for closing" : "Campaign progress saved"); },
    onError: (error: Error & { code?: string }, intent) => { setFailed(!error.code || error.code.startsWith("PGRST") ? intent : null); refresh(); toast.error(error.message); } });
  useWorkspaceDraft(Boolean(note.trim() || closer !== null), save.isPending);
  if (!team.data?.available) return team.error ? <p role="alert" className="text-sm text-destructive">Could not load campaign work roles.</p> : null;
  if (workflow.error) return <p role="alert" className="text-sm text-destructive">Could not load lead handoff: {workflow.error.message}</p>;
  if (!lead) return <p role="status" className="text-sm text-muted-foreground">Loading campaign handoff…</p>;
  const manager = canManage(role), setter = canSetAppointment(role, job), closing = canCloseLead(role, job, lead, access.userId);
  const assign = lead.workflow_stage === "qualified" && (manager || (setter && lead.qualified_by === access.userId));
  const workers = team.data.members.filter(member => member.access_role === "owner" || (canWork(member.access_role) && ["closer", "full_cycle"].includes(member.work_role)));
  const label = (user: string | null) => team.data?.members.find(member => member.user_id === user)?.label ?? (user ? "Former team member" : "Unassigned");
  const selected = closer ?? lead.assigned_closer_id ?? "unassigned";
  function act(action: WorkflowIntent["action"]) {
    if (!lead || save.isPending) return;
    setFailed(null);
    save.mutate({ campaign: campaignId, lead: leadId, action, requestId: crypto.randomUUID(), version: lead.workflow_version, closer: action === "assign" ? selected === "unassigned" ? null : selected : undefined, note });
  }
  return <Card className="border-primary/20"><CardHeader className="pb-2"><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base"><span className="flex items-center gap-2"><Handshake className="size-4 text-primary" />Campaign handoff</span><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{STAGE_LABELS[lead.workflow_stage]}</span></CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-xs text-muted-foreground">Your work role: <strong>{!canWork(role) ? "Read only" : job ? WORK_ROLE_LABELS[job] : canManage(role) ? "Full cycle" : "Read only"}</strong></p>
    {lead.workflow_stage === "prospecting" && <p className="text-sm leading-6 text-muted-foreground">Qualify this lead for a closer, or book a meeting in Log a touch. Either action moves it into this campaign’s Qualified tab.</p>}
    {lead.qualified_at && <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4 shrink-0 text-teal-600" /><span>Qualified by {label(lead.qualified_by)} · {new Date(lead.qualified_at).toLocaleString()}</span></p>}
    {lead.appointment_at && <p className="flex items-center gap-2 text-xs"><CalendarCheck className="size-4 shrink-0 text-primary" />Appointment: {new Date(lead.appointment_at).toLocaleString()}</p>}
    {lead.workflow_stage === "qualified" && <div className="space-y-2 rounded-lg bg-muted/50 p-3"><p className="text-xs font-medium">Closer: {label(lead.assigned_closer_id)}</p>{assign && <div className="flex flex-wrap gap-2"><Select value={selected} disabled={save.isPending} onValueChange={setCloser}><SelectTrigger aria-label="Handoff closer" className="min-h-11 min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned · available to claim</SelectItem>{workers.map(member => <SelectItem key={member.user_id} value={member.user_id}>{member.label}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={save.isPending || selected === (lead.assigned_closer_id ?? "unassigned")} onClick={() => act("assign")}>Save handoff</Button></div>}<p className="text-xs text-muted-foreground">{!lead.assigned_closer_id ? "A closer can claim this lead. " : ""}Pending meeting reminders follow the handoff.</p></div>}
    {canWork(role) && <Textarea aria-label="Campaign handoff note" placeholder="Handoff or outcome note (optional)…" value={note} onChange={event => setNote(event.target.value)} maxLength={5000} disabled={save.isPending} rows={2} />}
    <div className="flex flex-wrap gap-2">
      {setter && lead.workflow_stage === "prospecting" && <Button disabled={save.isPending} onClick={() => act("qualify")}>Mark qualified</Button>}
      {closing && !lead.assigned_closer_id && <Button disabled={save.isPending} onClick={() => act("claim")}>Claim for closing</Button>}
      {closing && <><Button disabled={save.isPending} onClick={() => act("won")}>Close won</Button><Button variant="outline" disabled={save.isPending} onClick={() => act("lost")}>Close lost</Button></>}
      {manager && lead.workflow_stage !== "prospecting" && <Button variant="ghost" disabled={save.isPending} onClick={() => { if (confirm("Reopen this lead for prospecting? Historical contributions stay in the report.")) act("reopen"); }}>Reopen lead</Button>}
    </div>
    {save.isPending && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 motion-safe:animate-spin" />Saving campaign progress…</p>}
    {save.error && <div role="alert" className="space-y-2 text-xs text-destructive"><p>{save.error.message}</p>{failed ? <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate(failed)}>Retry last save</Button> : <Button variant="outline" size="sm" onClick={refresh}>Refresh lead</Button>}</div>}
  </CardContent></Card>;
}
