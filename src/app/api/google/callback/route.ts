import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, exchangeCode, fetchGoogleEmail } from "@/lib/google-calendar";

// Google redirects here after consent. We exchange the code for a refresh token
// and store it against the user id we passed in `state`.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // app user id
  const error = url.searchParams.get("error");

  const settings = new URL("/settings", appUrl());

  if (error || !code || !state) {
    settings.searchParams.set("calendar", "error");
    return NextResponse.redirect(settings);
  }

  const tokens = await exchangeCode(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    settings.searchParams.set("calendar", "error");
    return NextResponse.redirect(settings);
  }

  const email = await fetchGoogleEmail(tokens.access_token);
  const admin = createAdminClient();
  const { error: dbError } = await admin.from("google_calendar_tokens").upsert(
    {
      user_id: state,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      google_email: email,
    },
    { onConflict: "user_id" }
  );

  settings.searchParams.set("calendar", dbError ? "error" : "connected");
  return NextResponse.redirect(settings);
}
