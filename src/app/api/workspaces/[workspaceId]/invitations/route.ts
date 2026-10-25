import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invitationEmailConfigured, invitationEmailEnabled, sendInvitationEmail } from "@/lib/invitation-email";
import { invitationOrigin, invitationRequest } from "@/lib/invitations";

type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(_request: Request, { params }: Context) {
  const { workspaceId } = await params;
  const supabase = await createClient(workspaceId);
  const { data, error } = await supabase.rpc("orms_is_owner");
  if (error || !data) return NextResponse.json({ error: "Workspace owner access required." }, { status: 403 });
  return NextResponse.json({ configured: invitationEmailConfigured() });
}
export async function POST(request: Request, { params }: Context) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { workspaceId } = await params;
  const supabase = await createClient(workspaceId);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid invitation." }, { status: 400 }); }
  const parsed = invitationRequest.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter an email and choose campaign access." }, { status: 400 });
  // Validate the canonical origin before creating a link or revoking an older
  // invitation. Never build email links from an untrusted Host header.
  let origin: string;
  try { origin = invitationOrigin(); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 503 }); }
  const { data, error } = await supabase.rpc("orms_create_invitation", { p_email: parsed.data.email, p_grants: parsed.data.grants });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : error.message.startsWith("Invitation limit reached") ? 429 : 400 });
  const url = `${origin}/join/${data.token}`;
  const delivery = await sendInvitationEmail({ id: data.id, email: data.email, workspaceName: data.workspace_name, inviterEmail: auth.user.email ?? "Your workspace owner", url });
  let trackingError = false;
  try { const result = await createAdminClient().rpc("orms_mark_invitation_delivery", { p_id: data.id, p_status: delivery }); trackingError = Boolean(result.error); } catch { trackingError = true; }
  return NextResponse.json({ id: data.id, url, email: data.email, expires_at: data.expires_at, delivery,
    warning: delivery === "not_configured" && invitationEmailEnabled() ? "Email delivery is not configured yet. You can copy and share the invitation link." : delivery === "failed" ? "We could not confirm that the email was sent. You can share this link or send a new invitation." : trackingError ? "The invitation's status could not be saved. You can still share this link." : undefined,
  }, { status: 201 });
}
