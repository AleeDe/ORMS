import type { SupabaseClient } from "@supabase/supabase-js";
import { safeReturnPath } from "./workspace";

export function passwordResetDestination(value: unknown) {
  let next = typeof value === "string" ? value : "/";
  try {
    const url = new URL(next);
    next = ["/auth/confirm", "/auth/reset-password"].includes(url.pathname) ? url.searchParams.get("next") ?? "/" : "/";
  } catch { /* A relative return path is expected. */ }
  next = safeReturnPath(next);
  return /^\/(?:auth\/|login\/update-password(?:\?|$))/.test(next) ? "/" : next;
}

export function isRecoveryToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

export function authFlowError(error: unknown, fallback = "We could not connect. Please try again.") {
  const detail = error as { code?: string; message?: string } | null;
  if (detail?.code === "otp_expired") return "That code or link is no longer valid. Request a new one and try again.";
  if (detail?.code === "over_email_send_rate_limit" || detail?.code === "over_request_rate_limit") return "Please wait a minute before requesting another email.";
  return detail?.message || fallback;
}

export function requestPasswordReset(auth: Pick<SupabaseClient["auth"], "resetPasswordForEmail">, email: string, origin: string, next: string) {
  const redirect = new URL("/auth/reset-password", origin);
  redirect.searchParams.set("next", passwordResetDestination(next));
  return auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: redirect.href });
}

export function verifySignupCode(auth: Pick<SupabaseClient["auth"], "verifyOtp">, email: string, value: string) {
  const token = value.replace(/[\s-]/g, "");
  if (!/^\d{6,10}$/.test(token)) throw Error("Enter the verification code from your email.");
  return auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "email" });
}
