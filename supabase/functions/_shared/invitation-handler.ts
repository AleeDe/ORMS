import { invitationEmailConfigured, sendInvitationEmail } from "./invitation-email.ts";

type Config = {
  supabaseUrl: string; anonKey: string; serviceRoleKey: string;
  apiKey?: string; sender?: string; enabled: boolean; appUrl: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Only delivers an existing, pending invitation created through the owner-only
// RPC. The recipient, workspace name and URL never come from the caller.
export async function handleInvitationEmail(request: Request, config: Config): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/i.test(authorization)) return json({ error: "Please sign in again." }, 401);
  const workspace = request.headers.get("x-orms-workspace") ?? "";
  if (!uuid.test(workspace)) return json({ error: "Choose a valid workspace." }, 400);
  const headers = { apikey: config.anonKey, Authorization: authorization, "x-orms-workspace": workspace, "Content-Type": "application/json" };
  const rest = (path: string, init?: RequestInit) => fetch(`${config.supabaseUrl}/rest/v1/${path}`, { ...init, headers, signal: AbortSignal.timeout(8_000) });
  try {
    const authResponse = await fetch(`${config.supabaseUrl}/auth/v1/user`, { headers, signal: AbortSignal.timeout(8_000) });
    if (!authResponse.ok) return json({ error: "Please sign in again." }, 401);
    const user = await authResponse.json() as { id?: string; email?: string; email_confirmed_at?: string };
    if (!user.id || !user.email || !user.email_confirmed_at) return json({ error: "Verify your email before inviting members." }, 403);
    const ownerResponse = await rest("rpc/orms_is_owner", { method: "POST", body: "{}" });
    if (!ownerResponse.ok || await ownerResponse.json() !== true) return json({ error: "Workspace owner access required." }, 403);
    if (request.method === "GET") return json({ configured: invitationEmailConfigured(config), enabled: config.enabled });

    const raw = await request.text();
    if (raw.length > 1024) return json({ error: "Invalid invitation." }, 400);
    let input: { id?: unknown; token?: unknown };
    try { input = JSON.parse(raw); } catch { return json({ error: "Invalid invitation." }, 400); }
    if (!input || typeof input.id !== "string" || !uuid.test(input.id) || typeof input.token !== "string" || !/^[0-9a-f]{64}$/.test(input.token)) return json({ error: "Invalid invitation." }, 400);
    const response = await rest(`team_invitations?id=eq.${input.id}&workspace_id=eq.${workspace}&select=id,email,token_hash,expires_at,accepted_at,revoked_at,delivery_status`);
    if (!response.ok) return json({ error: "Could not load the invitation." }, 503);
    const [invite] = await response.json() as { id: string; email: string; token_hash: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; delivery_status: string }[];
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.token))), byte => byte.toString(16).padStart(2, "0")).join("");
    if (!invite || invite.token_hash !== hash || invite.accepted_at || invite.revoked_at || !(Date.parse(invite.expires_at) > Date.now())) return json({ error: "This invitation is unavailable or has expired." }, 410);
    // A second request after a successful send is a no-op. Concurrent requests
    // use the same provider idempotency key and cannot send duplicate emails.
    if (invite.delivery_status === "sent") return json({ delivery: "sent", trackingError: false });
    const workspaceResponse = await rest(`workspaces?id=eq.${workspace}&select=name`);
    if (!workspaceResponse.ok) return json({ error: "Could not load the workspace." }, 503);
    const [company] = await workspaceResponse.json() as { name: string }[];
    if (!company) return json({ error: "Workspace owner access required." }, 403);
    let origin: URL;
    try { origin = new URL(config.appUrl); } catch { return json({ error: "Invitation links are not configured." }, 503); }
    if (origin.protocol !== "https:" || origin.username || origin.password) return json({ error: "Invitation links are not configured." }, 503);
    const delivery = await sendInvitationEmail({ id: invite.id, email: invite.email, workspaceName: company.name, inviterEmail: user.email, url: `${origin.origin}/join/${input.token}` }, config);
    let trackingError = false;
    try {
      const tracked = await fetch(`${config.supabaseUrl}/rest/v1/rpc/orms_mark_invitation_delivery`, {
        method: "POST", headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_id: invite.id, p_status: delivery }), signal: AbortSignal.timeout(8_000),
      });
      trackingError = !tracked.ok;
    } catch { trackingError = true; }
    return json({ delivery, trackingError });
  } catch {
    return json({ error: "Invitation email is temporarily unavailable. You can still share the invitation link." }, 503);
  }
}
