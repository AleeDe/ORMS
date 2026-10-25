import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";

type ConfirmationAuth = Pick<SupabaseClient["auth"], "exchangeCodeForSession" | "verifyOtp">;
const emailTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function confirmAuthLink(auth: ConfirmationAuth, params: URLSearchParams) {
  try {
    const code = params.get("code");
    if (code) {
      const { error } = await auth.exchangeCodeForSession(code);
      return !error;
    }
    const token_hash = params.get("token_hash");
    const type = params.get("type") as EmailOtpType | null;
    if (!token_hash || !type || !emailTypes.has(type)) return false;
    const { error } = await auth.verifyOtp({ type, token_hash });
    return !error;
  } catch {
    return false;
  }
}
