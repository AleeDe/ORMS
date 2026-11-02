"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import Link from "@/components/workspace-link";
import { useWorkspace, useWorkspaceClient } from "@/components/workspace-provider";
import { useCampaignTeam } from "@/hooks/use-campaign-team";
import { WORK_ROLE_LABELS, type WorkRole } from "@/lib/campaign-workflow";
import { canManage } from "@/lib/workspace";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CampaignTeamRoles({ campaignId }: { campaignId: string }) {
  const access = useWorkspace(), supabase = useWorkspaceClient(), client = useQueryClient();
  const { data, error } = useCampaignTeam(campaignId);
  const manage = canManage(access.role(campaignId));
  const change = useMutation({ mutationFn: async ({ user, workRole }: { user: string; workRole: WorkRole }) => {
    const { error } = await supabase.rpc("orms_set_campaign_work_role", { p_campaign: campaignId, p_user: user, p_work_role: workRole }); if (error) throw error;
  }, onSuccess: () => {
    for (const key of ["campaign-team", "campaign-performance", "campaign-workflow", "campaign-leads", "team-data"]) client.invalidateQueries({ queryKey: [key] });
    toast.success("Campaign work role updated");
  }, onError: error => toast.error(error.message) });
  if (error) return <p role="alert" className="text-sm text-destructive">Could not load campaign roles: {error.message}</p>;
  if (!data?.available) return null;
  return <details className="rounded-xl border bg-card p-4">
    <summary className="cursor-pointer text-sm font-semibold"><Users className="mr-2 inline size-4 text-primary" />Campaign team & work roles</summary>
    <p className="mt-3 text-xs leading-6 text-muted-foreground">Appointment setters qualify and book. Closers handle qualified leads and outcomes. Full cycle handles both. Work roles apply only to this campaign.</p>
    <div className="mt-3 space-y-2">{data.members.map(member => <div key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0"><p className="break-all text-sm font-medium">{member.label}</p><p className="text-xs capitalize text-muted-foreground">{member.access_role}{member.user_id === access.userId ? " · You" : ""}</p></div>
      {manage && member.access_role !== "owner" && member.access_role !== "viewer" ? <Select value={member.work_role} disabled={change.isPending} onValueChange={value => change.mutate({ user: member.user_id, workRole: value as WorkRole })}>
        <SelectTrigger aria-label={`Work role for ${member.label}`} className="min-h-11 w-48"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(WORK_ROLE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select> : <span className="rounded-full bg-muted px-3 py-1 text-xs">{member.access_role === "viewer" ? "Read only" : WORK_ROLE_LABELS[member.work_role]}</span>}
    </div>)}</div>
    {access.isOwner && <p className="mt-3 text-xs text-muted-foreground">Add teammates and control campaign access from <Link className="font-medium text-primary hover:underline" href="/team">Team & access</Link>.</p>}
  </details>;
}
