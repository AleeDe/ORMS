import { invitationEmailConfigured as configured, sendInvitationEmail as send, type InvitationEmail } from "../../supabase/functions/_shared/invitation-email";

export { invitationMessage, type InvitationDelivery } from "../../supabase/functions/_shared/invitation-email";
export function invitationEmailEnabled() { return process.env.WORKSPACE_INVITATION_EMAIL_ENABLED !== "false"; }
function config() {
  return { enabled: invitationEmailEnabled(), apiKey: process.env.RESEND_API_KEY, sender: process.env.RESEND_FROM_EMAIL };
}
export function invitationEmailConfigured() { return configured(config()); }
export function sendInvitationEmail(invite: InvitationEmail) { return send(invite, config()); }
