"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { canManage } from "@/lib/workspace";
import { useWorkspace, useWorkspaceClient } from "@/components/workspace-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Worker = { user_id: string; label: string };
export function TaskAssignment({ id, campaignId, assignedTo, completedBy, completed }: { id: string; campaignId: string | null; assignedTo: string | null; completedBy?: string | null; completed?: boolean }) {
  const access = useWorkspace();
  const editable = canManage(access.role(campaignId)) && !completed;
  const client = useQueryClient();
  const supabase = useWorkspaceClient();
  const { data: roster } = useQuery({ queryKey: ["team-roster"], queryFn: async () => { const { data, error } = await supabase.rpc("orms_roster"); if (error) throw error; return data as Worker[]; } });
  const { data: workers } = useQuery({ queryKey: ["campaign-workers", campaignId], enabled: editable && !!campaignId, queryFn: async () => { const { data, error } = await supabase.rpc("orms_campaign_workers", { p_campaign: campaignId }); if (error) throw error; return data as Worker[]; } });
  const change = useMutation({ mutationFn: async (user: string) => { const { error } = await supabase.from("tasks").update({ assigned_to: user === "unassigned" ? null : user }).eq("id", id).select("id").single(); if (error) throw error; }, onSuccess: () => { for (const key of ["tasks", "lead-tasks", "team-data"]) client.invalidateQueries({ queryKey: [key] }); toast.success("Task assignment updated"); }, onError: (error) => toast.error(error.message) });
  const label = (user: string | null) => user ? roster?.find((person) => person.user_id === user)?.label ?? (user === access.userId ? access.email : "Former team member") : "Unassigned";
  if (!editable) return <p className="max-w-52 break-words text-xs text-muted-foreground">{completed && completedBy ? `Completed by ${label(completedBy)}` : `Assigned to ${label(assignedTo)}`}</p>;
  const choices = campaignId ? workers ?? [] : [{ user_id: access.userId, label: access.email }];
  return <Select value={assignedTo ?? "unassigned"} disabled={change.isPending} onValueChange={(value) => change.mutate(value)}><SelectTrigger aria-label="Assign task" className="min-h-10 w-full max-w-52 text-xs"><SelectValue placeholder={label(assignedTo)} /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{choices.map((person) => <SelectItem key={person.user_id} value={person.user_id}>{person.label}</SelectItem>)}</SelectContent></Select>;
}
