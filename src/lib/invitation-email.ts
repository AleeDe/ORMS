type InvitationEmail = { id: string; email: string; workspaceName: string; inviterEmail: string; url: string };
export type InvitationDelivery = "sent" | "failed" | "not_configured";
export function invitationEmailEnabled() { return process.env.WORKSPACE_INVITATION_EMAIL_ENABLED === "true"; }
export function invitationEmailConfigured() { return invitationEmailEnabled() && Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim()); }
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
export function invitationMessage(invite: InvitationEmail) {
  const name = escapeHtml(invite.workspaceName);
  const inviter = escapeHtml(invite.inviterEmail);
  const url = escapeHtml(invite.url);
  return {
    subject: `Join ${invite.workspaceName.replace(/[\r\n]/g, " ")} on ORMS`,
    text: `${invite.inviterEmail} invited you to ${invite.workspaceName} on ORMS.\n\nReview your campaign access and accept: ${invite.url}\n\nSign in or create an account using ${invite.email}. You can keep your existing workspaces. This invitation expires in seven days. If you were not expecting it, you can ignore it.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#182234;line-height:1.7"><p style="color:#5557e8;font-weight:700;letter-spacing:3px">ORMS</p><h1>Join ${name}</h1><p>${inviter} invited you to their outreach workspace.</p><p>Review the campaigns and permissions offered before you accept.</p><p style="margin:28px 0"><a href="${url}" style="background:#5557e8;color:white;padding:14px 22px;border-radius:12px;text-decoration:none">Review invitation</a></p><p>Sign in or create an account using <strong>${escapeHtml(invite.email)}</strong>. Your existing workspaces stay separate.</p><p style="font-size:12px;color:#64748b">Expires in seven days. If you were not expecting this invitation, you can ignore it.</p><p style="font-size:12px;word-break:break-all"><a href="${url}">${url}</a></p></div>`,
  };
}
export async function sendInvitationEmail(invite: InvitationEmail): Promise<InvitationDelivery> {
  if (!invitationEmailConfigured()) return "not_configured";
  // Keep the payload and key identical if the provider accepted a request but
  // its response was lost. A transient retry must not send a second email.
  const body = JSON.stringify({ from: process.env.RESEND_FROM_EMAIL!.trim(), to: [invite.email], ...invitationMessage(invite) });
  const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json", "Idempotency-Key": `orms-invitation/${invite.id}` };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers, body, signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        const data = await response.json() as { id?: unknown };
        return typeof data.id === "string" && data.id.trim() ? "sent" : "failed";
      }
      if (attempt === 1 || (response.status !== 429 && response.status < 500)) return "failed";
    } catch {
      if (attempt === 1) return "failed";
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  return "failed";
}
