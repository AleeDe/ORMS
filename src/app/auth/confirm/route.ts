import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Exchanges the token_hash from a Supabase auth email (password recovery, email
// confirmation) for a real session cookie, then forwards to `next`.
//
// @supabase/ssr uses the PKCE flow, so recovery links carry ?token_hash=&type=
// rather than a URL fragment — the exchange has to happen server-side here
// before the update-password page can call updateUser().
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const redirectTo = new URL(next, request.url);

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Session is now in cookies; the destination page can update the password.
      return NextResponse.redirect(redirectTo);
    }
  }

  // Expired or already-used link — send them back to request a fresh one.
  const errorUrl = new URL("/login/forgot-password", request.url);
  errorUrl.searchParams.set("error", "invalid_link");
  return NextResponse.redirect(errorUrl);
}
