"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Workspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkspaceDirectory({ workspaces, error }: { workspaces: Workspace[]; error?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  return <main className="mx-auto w-full max-w-4xl space-y-8 p-5 py-10 sm:p-10">
    <div><Link href="/" className="text-sm font-bold tracking-widest text-primary">ORMS</Link><h1 className="mt-5 text-3xl font-semibold">Your workspaces</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">One account for your companies and teams. Choose where you want to work.</p></div>
    {(error || failure) && <p role="alert" className="text-sm text-destructive">{error || failure}</p>}
    <div className="grid gap-4 sm:grid-cols-2">{workspaces.map(workspace => <Link key={workspace.id} href={`/w/${workspace.id}/campaigns`} className="flex min-w-0 items-center gap-4 rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Building2 className="size-5" /></span><div className="min-w-0 flex-1"><p className="truncate font-semibold">{workspace.name}</p><p className="mt-1 text-xs text-muted-foreground">{workspace.is_owner ? "Owner · Your workspace" : "Team member · Assigned campaigns"}</p></div><ArrowRight className="size-4 shrink-0" /></Link>)}</div>
    <form className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setFailure("");
      const { data, error } = await createClient().rpc("orms_create_workspace", { p_name: name.trim() });
      if (error) { setFailure(error.message); setBusy(false); return; }
      router.push(`/w/${data}/campaigns`);
    }}><div><h2 className="flex items-center gap-2 font-semibold"><Plus className="size-4 text-primary" /> Create your own workspace</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Your new workspace starts empty. Its data, settings and team access are separate.</p></div><div className="space-y-2"><Label htmlFor="workspace-name">Workspace name</Label><Input id="workspace-name" value={name} onChange={event => setName(event.target.value)} required maxLength={100} placeholder="Company or project name" className="min-h-11" /></div><Button className="min-h-11 w-full sm:w-auto" disabled={busy || !name.trim()}>{busy ? "Creating workspace…" : "Create workspace"}</Button></form>
  </main>;
}
