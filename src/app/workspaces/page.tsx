import { createClient } from "@/lib/supabase/server";
import { WorkspaceDirectory } from "@/components/workspace-directory";
import type { Workspace } from "@/lib/workspace";

export default async function WorkspacesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("orms_workspaces");
  return <WorkspaceDirectory workspaces={(data ?? []) as Workspace[]} error={error?.message} />;
}
