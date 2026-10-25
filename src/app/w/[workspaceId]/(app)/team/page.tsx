"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, LoaderCircle, Mail, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace, useWorkspaceClient, useWorkspaceDraft } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CampaignRole } from "@/lib/workspace";

type TeamData = {
  members: { user_id: string; email: string; label: string; open_tasks: number; completed_tasks: number; overdue_tasks: number; touches: number }[];
  campaigns: { id: string; name: string }[];
  access: { user_id: string; campaign_id: string; role: CampaignRole }[];
  invitations: { id: string; email: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; delivery_status: string; grants: { campaign_id: string; role: string }[] }[];
};
const roles = ["member", "manager", "viewer"] as const;

export default function TeamPage() {
  const { workspace, isOwner, refreshAccess } = useWorkspace();
  const supabase = useWorkspaceClient();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [workspaceName, setWorkspaceName] = useState(workspace.name);
  const [role, setRole] = useState<string>("member");
  const [selected, setSelected] = useState<string[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [invitation, setInvitation] = useState<{ id: string; url: string; email: string; expires: string; delivery: string; warning?: string } | null>(null);
  const { data, error, isPending } = useQuery({ queryKey: ["team-data"], enabled: isOwner, queryFn: async () => {
    const { data, error } = await supabase.rpc("orms_team_data"); if (error) throw error; return data as TeamData;
  } });
  useWorkspaceDraft(Boolean(email.trim() || selected.length || workspaceName !== workspace.name));
  const endpoint = `/api/workspaces/${workspace.id}/invitations`;
  const { data: emailConfig, isPending: checkingEmail, error: emailConfigError, refetch: retryEmailConfig } = useQuery({ queryKey: ["invitation-email-config"], enabled: isOwner, queryFn: async () => { const response = await fetch(endpoint); if (!response.ok) throw Error("Could not check invitation email availability."); return response.json() as Promise<{ configured: boolean }>; } });
  function refresh() {
    client.invalidateQueries({ queryKey: ["team-data"] });
    client.invalidateQueries({ queryKey: ["campaign-workers"] });
    client.invalidateQueries({ queryKey: ["team-roster"] });
    client.invalidateQueries({ queryKey: ["tasks"] });
    client.invalidateQueries({ queryKey: ["lead-tasks"] });
    refreshAccess();
  }
  const invite = useMutation({ mutationFn: async (retry?: { email: string; grants: { campaign_id: string; role: string }[] }) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(retry ?? { email: email.trim(), grants: selected.map(campaign_id => ({ campaign_id, role })) }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error ?? "Could not create the invitation.");
    return result as { id: string; url: string; email: string; expires_at: string; delivery: string; warning?: string };
  }, onSuccess: (created, retry) => { setInvitation({ id: created.id, url: created.url, email: created.email, expires: created.expires_at, delivery: created.delivery, warning: created.warning }); if (!retry) { setEmail(""); setSelected([]); } refresh(); if (created.delivery === "sent") toast.success("Invitation email sent"); else toast.info("Invitation link created. You can copy and share it."); }, onError: error => toast.error(error.message) });
  const changeAccess = useMutation({ mutationFn: async ({ user, campaign, role }: { user: string; campaign: string; role: string }) => {
    const { error } = await supabase.rpc("orms_set_campaign_access", { p_user: user, p_campaign: campaign, p_role: role === "none" ? null : role }); if (error) throw error;
  }, onSuccess: () => { refresh(); toast.success("Campaign access updated"); }, onError: (error) => toast.error(error.message) });
  const remove = useMutation({ mutationFn: async (user: string) => { const { error } = await supabase.rpc("orms_remove_member", { p_user: user }); if (error) throw error; }, onSuccess: () => { refresh(); toast.success("Member removed. Unfinished tasks are now unassigned."); }, onError: (error) => toast.error(error.message) });
  const revoke = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("team_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id).select("id").single(); if (error) throw error; }, onSuccess: (_data, id) => { setInvitation(current => current?.id === id ? null : current); refresh(); toast.success("Invitation revoked"); }, onError: (error) => toast.error(error.message) });
  const rename = useMutation({ mutationFn: async (name: string) => { const { error } = await supabase.from("workspaces").update({ name: name.trim() }).eq("id", workspace.id).select("id").single(); if (error) throw error; }, onSuccess: () => { refreshAccess(); toast.success("Workspace name saved"); }, onError: (error) => toast.error(error.message) });
  if (!isOwner) return null;
  const activeCampaign = campaignId || data?.campaigns[0]?.id || "";
  const pending = data?.invitations.filter((item) => !item.accepted_at && !item.revoked_at && new Date(item.expires_at) > new Date()) ?? [];
  return <div className="space-y-6">
    <div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">People behind the progress</p><h1 className="flex items-center gap-3 text-3xl font-bold"><Users className="size-7 text-primary" /> Team & access</h1><p className="mt-2 text-sm text-muted-foreground">Invite teammates with their own logins. Choose exactly which campaigns they can work on.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {isPending && <p role="status">Loading your team…</p>}
    <Card><CardHeader><CardTitle className="text-base">Company workspace</CardTitle></CardHeader><CardContent><form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); rename.mutate(new FormData(event.currentTarget).get("name") as string); }}><Input name="name" aria-label="Workspace name" required maxLength={100} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} className="min-h-11 w-full sm:w-80" /><Button className="min-h-11" disabled={rename.isPending}>Save name</Button></form></CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserPlus className="size-4 text-primary" /> Invite a teammate</CardTitle><CardDescription>Invite their existing email address. They can join this workspace and keep their own workspaces. Invitations expire after seven days.</CardDescription></CardHeader><CardContent className="space-y-4">
      {checkingEmail && <p role="status" className="text-sm text-muted-foreground">Checking invitation email availability…</p>}
      {emailConfigError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"><p>{emailConfigError.message}</p><Button variant="outline" size="sm" onClick={() => retryEmailConfig()}>Try again</Button></div>}
      {emailConfig && !emailConfig.configured && <p className="text-sm text-muted-foreground">Create an invitation link, then copy and share it with your teammate. Only their verified email can accept.</p>}
      <form className="space-y-4" aria-busy={invite.isPending} onSubmit={(event) => { event.preventDefault(); if (!invite.isPending && emailConfig && selected.length) invite.mutate(undefined); }}>
        <fieldset disabled={invite.isPending || checkingEmail || Boolean(emailConfigError)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="team-email">Teammate email</Label><Input id="team-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@company.com" className="min-h-11" /></div><div className="space-y-2"><Label htmlFor="invite-role">Campaign role</Label><Select value={role} onValueChange={setRole}><SelectTrigger id="invite-role" className="min-h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{roles.map((value) => <SelectItem key={value} value={value} className="capitalize">{value}</SelectItem>)}</SelectContent></Select></div></div>
        <p className="text-xs leading-5 text-muted-foreground">Members log outreach and work on their tasks. Managers can also assign and manage campaign tasks. Viewers have read-only access. Company data and access settings stay with you.</p>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Campaign access</legend>{!data?.campaigns.length && <p className="text-sm text-muted-foreground">Create a campaign before inviting your team.</p>}<div className="grid gap-2 sm:grid-cols-2">{data?.campaigns.map((campaign) => <label key={campaign.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={selected.includes(campaign.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, campaign.id] : current.filter((id) => id !== campaign.id))} /><span className="break-words">{campaign.name}</span></label>)}</div></fieldset>
        <Button className="min-h-11" disabled={invite.isPending || checkingEmail || Boolean(emailConfigError) || !selected.length}>{invite.isPending ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : emailConfig?.configured ? <Mail className="size-4" /> : <Link2 className="size-4" />}{invite.isPending ? emailConfig?.configured ? "Sending invitation…" : "Creating invitation…" : emailConfig?.configured ? "Send invitation email" : "Create invitation link"}</Button>
        </fieldset>
      </form>
      {invitation && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="break-all text-sm font-medium">Invitation for {invitation.email}</p><p className="text-xs text-muted-foreground" role="status">{invitation.delivery === "sent" ? "Invitation email sent. Your teammate can review their campaign access from the email." : "Invitation link ready."}</p>{invitation.warning && <p role="alert" className="text-xs leading-5 text-muted-foreground">{invitation.warning}</p>}<p className="text-xs text-muted-foreground">Expires {new Date(invitation.expires).toLocaleString()}. Only that verified email can accept.</p><div className="flex flex-wrap gap-2"><Input aria-label="Invitation link" value={invitation.url} readOnly className="min-h-11 min-w-0 flex-1 text-xs" /><Button variant="outline" className="min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(invitation.url); toast.success("Invitation link copied"); } catch { toast.error("Select and copy the invitation link above."); } }}><Copy className="size-4" /> Copy link</Button></div></div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-primary" /> Campaign permissions</CardTitle><CardDescription>Changing access applies to database requests immediately. Removing working access releases unfinished tasks for reassignment.</CardDescription></CardHeader><CardContent className="space-y-4">
      {data?.campaigns.length ? <Select value={activeCampaign} onValueChange={setCampaignId}><SelectTrigger aria-label="Campaign for team permissions" className="min-h-11 w-full sm:w-80"><SelectValue /></SelectTrigger><SelectContent>{data.campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}</SelectContent></Select> : null}
      {data?.members.filter((member) => member.user_id !== workspace.owner_id).map((member) => <div key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{member.label}</p><p className="break-all text-xs text-muted-foreground">{member.email}</p></div><div className="flex flex-wrap gap-2"><Select disabled={!activeCampaign || changeAccess.isPending} value={data.access.find((access) => access.user_id === member.user_id && access.campaign_id === activeCampaign)?.role ?? "none"} onValueChange={(role) => changeAccess.mutate({ user: member.user_id, campaign: activeCampaign, role })}><SelectTrigger aria-label={`Campaign role for ${member.email}`} className="min-h-11 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No access</SelectItem>{roles.map((value) => <SelectItem key={value} value={value} className="capitalize">{value}</SelectItem>)}</SelectContent></Select><Button variant="ghost" className="min-h-11 text-destructive" disabled={remove.isPending} onClick={() => { if (confirm(`Remove ${member.email} from this workspace? Their history will be retained and unfinished tasks will become unassigned.`)) remove.mutate(member.user_id); }}>Remove member</Button></div></div>)}
      {data?.members.length === 1 && <p className="text-sm text-muted-foreground">Accepted teammates will appear here.</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Team progress</CardTitle><CardDescription>Current open assignments, completed tasks, overdue work, and logged outreach touches.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data?.members.map((member) => <div key={member.user_id} className="rounded-xl border p-4"><p className="break-all text-sm font-semibold">{member.label} {member.user_id === workspace.owner_id && <Badge variant="secondary">Owner</Badge>}</p><dl className="mt-3 grid grid-cols-2 gap-3 text-xs">{[["Open tasks",member.open_tasks],["Completed",member.completed_tasks],["Overdue",member.overdue_tasks],["Touches",member.touches]].map(([label,value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}</dl></div>)}</CardContent></Card>
    {!!pending.length && <Card><CardHeader><CardTitle className="text-base">Pending invitations</CardTitle><CardDescription>Sending a new invitation replaces the previous link.</CardDescription></CardHeader><CardContent className="space-y-3">{pending.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{item.email}</p><p className="text-xs text-muted-foreground">Expires {new Date(item.expires_at).toLocaleDateString()} · {item.delivery_status === "sent" ? "Email sent" : item.delivery_status === "failed" ? "Email not confirmed" : "Link created"}</p></div><div className="flex gap-2"><Button variant="outline" disabled={invite.isPending || revoke.isPending || checkingEmail || Boolean(emailConfigError)} onClick={() => { if (!invite.isPending) invite.mutate({ email: item.email, grants: item.grants }); }}>{emailConfig?.configured ? "Send again" : "New link"}</Button><Button variant="outline" disabled={revoke.isPending || invite.isPending} onClick={() => revoke.mutate(item.id)}>Revoke</Button></div></div>)}</CardContent></Card>}
  </div>;
}
