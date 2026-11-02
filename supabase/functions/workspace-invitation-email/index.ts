import { handleInvitationEmail } from "../_shared/invitation-handler.ts";

Deno.serve((request: Request) => handleInvitationEmail(request, {
  supabaseUrl: Deno.env.get("SUPABASE_URL")!,
  anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  apiKey: Deno.env.get("RESEND_API_KEY"),
  sender: Deno.env.get("RESEND_FROM_EMAIL"),
  enabled: Deno.env.get("WORKSPACE_INVITATION_EMAIL_ENABLED") !== "false",
  appUrl: Deno.env.get("WORKSPACE_INVITATION_APP_URL") ?? "",
}));
