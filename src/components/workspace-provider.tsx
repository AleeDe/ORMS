"use client";

import { createContext, useContext, useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { selectWorkspace, workspaceIdFromPath, workspacePath, type Workspace, type CampaignRole } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { WorkspaceLoading } from "@/components/workspace-loading";

type Access = { workspace: Workspace; userId: string; email: string; isOwner: boolean; role: (campaignId: string | null) => CampaignRole | null; refreshAccess: () => Promise<void>; drafts: Set<string>; busy: Set<string> };
const WorkspaceContext = createContext<Access | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw Error("Workspace access has not loaded");
  return context;
}
export function useWorkspaceClient() { return createClient(useWorkspace().workspace.id); }
export function useWorkspaceDraft(dirty: boolean, pending = false) {
  const { drafts, busy } = useWorkspace();
  const id = useId();
  useEffect(() => {
    if (dirty) drafts.add(id); else drafts.delete(id);
    if (pending) busy.add(id); else busy.delete(id);
    return () => { drafts.delete(id); busy.delete(id); };
  }, [dirty, pending, drafts, busy, id]);
}
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const selected = workspaceIdFromPath(usePathname());
  const accessClient = useQueryClient();
  const router = useRouter();
  const { data, error, refetch } = useQuery({
    queryKey: ["workspace-access"], staleTime: 30_000, refetchInterval: 60_000,
    queryFn: async () => {
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw Error("Please sign in again.");
      const { data: workspaces, error } = await supabase.rpc("orms_workspaces");
      if (error) throw error;
      return { user: auth.user, workspaces: workspaces as Workspace[] };
    },
  });
  const active = data?.workspaces.find((workspace) => workspace.id === selected);
  useEffect(() => { if (active) selectWorkspace(active.id); }, [active]);
  if (error && !data) return <div className="m-auto max-w-md space-y-4 p-6"><h1 className="text-xl font-semibold">Could not open your workspace</h1><p role="alert" className="text-sm text-muted-foreground">{error.message}</p><Button onClick={() => refetch()}>Retry</Button><Button variant="outline" onClick={() => router.push("/login")}>Sign in</Button></div>;
  if (!data) return <WorkspaceLoading />;
  if (!active) return <div className="m-auto max-w-md space-y-4 p-6"><h1 className="text-xl font-semibold">Workspace unavailable</h1><p className="text-sm text-muted-foreground">Your account does not have access to this workspace, or your access was removed.</p><Button asChild><Link href="/workspaces">Choose another workspace</Link></Button></div>;
  const permissions = active.is_owner ? "owner" : JSON.stringify([...active.campaigns].sort((a,b) => a.id.localeCompare(b.id)));
  return <WorkspaceSession key={`${data.user.id}:${active.id}:${permissions}`} workspace={active} userId={data.user.id} email={data.user.email ?? ""} choices={data.workspaces} refreshAccess={() => accessClient.invalidateQueries({ queryKey: ["workspace-access"] })}>{children}</WorkspaceSession>;
}

const ChoicesContext = createContext<Workspace[]>([]);
export function useWorkspaceChoices() { return useContext(ChoicesContext); }

function WorkspaceSession({ workspace, userId, email, choices, children, refreshAccess }: { workspace: Workspace; userId: string; email: string; choices: Workspace[]; children: React.ReactNode; refreshAccess: () => Promise<void> }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  const [drafts] = useState(() => new Set<string>());
  const [busy] = useState(() => new Set<string>());
  useEffect(() => {
    function guard(event: BeforeUnloadEvent) { if (drafts.size || busy.size || client.isMutating()) event.preventDefault(); }
    window.addEventListener("beforeunload", guard);
    return () => { window.removeEventListener("beforeunload", guard); client.clear(); };
  }, [client, drafts, busy]);
  const access = { workspace, userId, email, isOwner: workspace.is_owner, refreshAccess, drafts, busy, role: (id: string | null): CampaignRole | null => workspace.is_owner ? "owner" : workspace.campaigns.find((campaign) => campaign.id === id)?.role ?? null };
  return <WorkspaceContext.Provider value={access}><ChoicesContext.Provider value={choices}><QueryClientProvider client={client}>{children}</QueryClientProvider></ChoicesContext.Provider></WorkspaceContext.Provider>;
}

export function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  const { isOwner, workspace } = useWorkspace();
  const pathname = workspacePath(usePathname());
  const router = useRouter();
  useEffect(() => { if (!isOwner && pathname === "/") router.replace(`/w/${workspace.id}/campaigns`); }, [isOwner, pathname, router, workspace.id]);
  const allowed = isOwner || ["/campaigns", "/tasks", "/notifications", "/help"].includes(pathname) || /^\/(campaigns|leads)\/[^/]+$/.test(pathname);
  if (!allowed) return <div className="space-y-4 rounded-xl border bg-card p-6"><h1 className="text-xl font-semibold">Your campaign workspace</h1><p className="text-sm text-muted-foreground">Your account has access to assigned campaigns. Company settings and the shared lead library are managed by the owner.</p><Button asChild><Link href={`/w/${workspace.id}/campaigns`}>Open assigned campaigns</Link></Button></div>;
  return children;
}
export function OwnerOnly({ children }: { children: React.ReactNode }) { return useWorkspace().isOwner ? children : null; }
