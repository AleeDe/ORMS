"use client";

import { useState } from "react";
import { useIsMutating, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace, useWorkspaceChoices, useWorkspaceClient } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function WorkspaceSwitcher() {
  const { workspace, isOwner, drafts, busy, refreshAccess } = useWorkspace();
  const choices = useWorkspaceChoices();
  const saving = useIsMutating();
  const router = useRouter();
  const supabase = useWorkspaceClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  function canLeave() {
    if (saving || busy.size) { toast.info("Wait for your current save or import to finish."); return false; }
    return !drafts.size || confirm("You have unsaved changes. Discard them and change workspace?");
  }
  const create = useMutation({ mutationFn: async () => {
    const { data, error } = await supabase.rpc("orms_create_workspace", { p_name: name.trim() });
    if (error) throw error;
    return data as string;
  }, onSuccess: async id => { await refreshAccess(); setOpen(false); router.push(`/w/${id}/campaigns`); }, onError: error => toast.error(error.message) });
  return <div className="flex min-w-0 items-center gap-2">
    <Select value={workspace.id} disabled={saving > 0} onValueChange={id => {
      if (id === "create") { setOpen(true); return; }
      if (id === workspace.id || !canLeave()) return;
      router.push(id === "browse" ? "/workspaces" : `/w/${id}/campaigns`);
    }}><SelectTrigger aria-label="Company workspace" className="min-h-11 w-44 max-w-full bg-background sm:w-56"><Building2 className="size-4 shrink-0" /><SelectValue /></SelectTrigger><SelectContent>
      {choices.map(choice => <SelectItem key={choice.id} value={choice.id}>{choice.name} · {choice.is_owner ? "Owner" : "Member"}</SelectItem>)}
      <SelectItem value="create"><Plus className="size-4" /> Create workspace</SelectItem>
      <SelectItem value="browse">All workspaces</SelectItem>
    </SelectContent></Select>
    <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">{isOwner ? "Owner" : "Team member"}</Badge>
    <Dialog open={open} onOpenChange={value => { if (!create.isPending) setOpen(value); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Create a workspace</DialogTitle><DialogDescription>Start a separate company workspace. You will be its owner, with its own leads, campaigns and team.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); if (canLeave()) create.mutate(); }}><div className="space-y-2"><Label htmlFor="new-workspace-name">Workspace name</Label><Input id="new-workspace-name" value={name} onChange={event => setName(event.target.value)} required maxLength={100} autoFocus placeholder="Your company or project" className="min-h-11" /></div><Button className="min-h-11 w-full" disabled={create.isPending || !name.trim()}>{create.isPending ? "Creating workspace…" : "Create workspace"}</Button></form></DialogContent></Dialog>
  </div>;
}
