export type CampaignRole = "owner" | "manager" | "member" | "viewer";
export type Workspace = {
  id: string; owner_id: string; name: string; is_owner: boolean;
  campaigns: { id: string; role: CampaignRole }[];
};
const WORKSPACE_PATH = /^\/w\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?=\/|$)/i;
export function workspaceIdFromPath(path: string) { return path.match(WORKSPACE_PATH)?.[1].toLowerCase() ?? null; }
export function workspacePath(path: string) { return path.replace(WORKSPACE_PATH, "") || "/"; }
export function workspaceHref(id: string, href: string) {
  if (!href.startsWith("/") || href.startsWith("//") || /^\/(w|login|auth|join|api|workspaces)(?:\/|\?|$)/.test(href)) return href;
  return `/w/${id}${href === "/" ? "" : href}`;
}
export function canWork(role?: CampaignRole | null) {
  return role === "owner" || role === "manager" || role === "member";
}
export function canManage(role?: CampaignRole | null) {
  return role === "owner" || role === "manager";
}
export function canChangeTask(role: CampaignRole | null, userId: string, assignedTo: string | null) {
  return canManage(role) || (role === "member" && (!assignedTo || assignedTo === userId));
}
export function safeReturnPath(value: string | null | undefined) {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/";
  const url = new URL(value, "https://orms.invalid");
  return url.origin === "https://orms.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/";
}

export function selectWorkspace(id: string) {
  document.cookie = `orms_workspace=${encodeURIComponent(id)}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

// Capture scope when creating the client, before a delayed save reaches the
// network. The database independently validates this untrusted id.
export function createWorkspaceFetch(workspaceId: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("x-orms-workspace", workspaceId);
    return fetch(input, { ...init, headers });
  };
}
