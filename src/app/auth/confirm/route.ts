import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/workspace";
import { confirmAuthLink } from "@/lib/auth-confirmation";

// Support both default Supabase PKCE redirects and custom token-hash email
// templates. Keep the invitation destination through verification and errors.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const next = safeReturnPath(searchParams.get("next"));
  if (searchParams.has("code") || searchParams.has("token_hash")) {
    const supabase = await createClient();
    if (await confirmAuthLink(supabase.auth, searchParams)) return NextResponse.redirect(new URL(next, request.url));
  }
  const errorUrl = new URL("/auth/error", request.url);
  errorUrl.searchParams.set("next", next);
  if (next === "/login/update-password" || searchParams.get("type") === "recovery") errorUrl.searchParams.set("kind", "recovery");
  return NextResponse.redirect(errorUrl);
}
