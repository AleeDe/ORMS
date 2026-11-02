import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const existingEmailMessage = "An account already exists with this email. Sign in or reset your password.";
export class EmailAlreadyRegisteredError extends Error {
  constructor() { super(existingEmailMessage); this.name = "EmailAlreadyRegisteredError"; }
}
export function isSignupEmail(email: string) { return emailSchema.safeParse(email).success; }
export async function signupEmailAvailable(supabase: Pick<SupabaseClient, "rpc">, email: string, signal?: AbortSignal): Promise<boolean> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) throw Error("Enter a valid email address.");
  const request = supabase.rpc("orms_signup_email_available", { p_email: parsed.data });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw Error(error.code === "email_check_rate_limit" ? "Too many email checks. Wait a minute and try again." : "We could not check this email. Please try again.");
  if (typeof data !== "boolean") throw Error("We could not check this email. Please try again.");
  return data;
}
export async function signUpWithAvailableEmail(supabase: Pick<SupabaseClient, "rpc" | "auth">, email: string, password: string, emailRedirectTo: string) {
  // Refresh the lookup at submit time; the on-screen check may be stale.
  if (!await signupEmailAvailable(supabase, email)) throw new EmailAlreadyRegisteredError();
  const result = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { emailRedirectTo } });
  if (result.error && ["user_already_exists", "email_exists"].includes(result.error.code ?? "")) throw new EmailAlreadyRegisteredError();
  // Supabase can return an obfuscated user for an already registered address.
  // This also catches an account created after our availability check.
  if (!result.error && result.data.user?.identities?.length === 0) throw new EmailAlreadyRegisteredError();
  if (!result.error && (!result.data.user || (!result.data.session && !Array.isArray(result.data.user.identities)))) throw Error("We could not confirm account creation. Please try again.");
  return result;
}
