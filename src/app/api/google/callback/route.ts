import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { appUrl, exchangeCode, fetchGoogleEmail } from "@/lib/google-calendar";
import { workspaceIdFromPath } from "@/lib/workspace";

export async function GET(request: NextRequest) {
  let binding: { state?: string; userId?: string; workspaceId?: string } = {};
  try { binding = JSON.parse(request.cookies.get("orms_google_oauth")?.value ?? "{}"); } catch {}
  const workspaceId = binding.workspaceId ?? "";
  const validWorkspace = workspaceIdFromPath(`/w/${workspaceId}`) === workspaceId;
  const settings = new URL(validWorkspace ? `/w/${workspaceId}/settings` : "/workspaces", appUrl());
  function done(success = false) {
    settings.searchParams.set("calendar", success ? "connected" : "error");
    const response = NextResponse.redirect(settings);
    response.cookies.delete({ name: "orms_google_oauth", path: "/api/google" });
    return response;
  }
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (!validWorkspace || !code || request.nextUrl.searchParams.has("error") || !/^[a-f0-9]{64}$/.test(state) || !binding.state || binding.state.length !== state.length || !timingSafeEqual(Buffer.from(binding.state), Buffer.from(state))) return done();
  const supabase = await createClient(workspaceId);
  const [{ data: auth }, { data: scope }] = await Promise.all([supabase.auth.getUser(), supabase.rpc("orms_current_workspace")]);
  if (!auth.user || auth.user.id !== binding.userId || scope !== workspaceId) return done();
  try {
    const tokens = await exchangeCode(code);
    if (!tokens.access_token || !tokens.refresh_token) return done();
    const email = await fetchGoogleEmail(tokens.access_token);
    const { error } = await createAdminClient().from("google_calendar_tokens").upsert({
      user_id: auth.user.id, workspace_id: workspaceId, refresh_token: tokens.refresh_token,
      access_token: tokens.access_token, access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(), google_email: email,
    }, { onConflict: "workspace_id,user_id" });
    return done(!error);
  } catch { return done(); }
}
