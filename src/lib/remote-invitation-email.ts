import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvitationDelivery } from "./invitation-email";

const functionName = "workspace-invitation-email";
export async function remoteInvitationEmailConfigured(supabase: SupabaseClient) {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, { method: "GET" });
    return !error && data?.configured === true;
  } catch { return false; }
}
export async function sendRemoteInvitationEmail(supabase: SupabaseClient, invitation: { id: string; token: string }): Promise<{ delivery: InvitationDelivery; trackingError: boolean }> {
  // Never retry invitation creation after an uncertain send. The same link
  // remains available for sharing, even if the email service cannot be reached.
  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body: invitation });
    if (!error && ["sent", "failed", "not_configured"].includes(data?.delivery)) return { delivery: data.delivery, trackingError: data.trackingError === true };
  } catch { /* Return a recoverable result with the already-created link. */ }
  return { delivery: "failed", trackingError: true };
}
