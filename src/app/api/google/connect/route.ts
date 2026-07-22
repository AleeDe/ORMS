import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consentUrl, googleConfigured } from "@/lib/google-calendar";

// Kicks off the Google consent flow for the signed-in user.
export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google Calendar is not configured on this server." },
      { status: 503 }
    );
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL));
  }
  return NextResponse.redirect(consentUrl(data.user.id));
}
