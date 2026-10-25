import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consentUrl, googleConfigured } from "@/lib/google-calendar";
import { workspaceIdFromPath } from "@/lib/workspace";

export async function GET(request: NextRequest) {
  if (!googleConfigured()) return NextResponse.json({ error: "Google Calendar is not configured on this server." }, { status: 503 });
  const workspaceId = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!workspaceIdFromPath(`/w/${workspaceId}`)) return NextResponse.json({ error: "Choose a workspace." }, { status: 400 });
  const supabase = await createClient(workspaceId);
  const [{ data: auth }, { data: scope }] = await Promise.all([supabase.auth.getUser(), supabase.rpc("orms_current_workspace")]);
  if (!auth.user || scope !== workspaceId) return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
  const state = randomBytes(32).toString("hex");
  const response = NextResponse.redirect(consentUrl(state));
  response.cookies.set("orms_google_oauth", JSON.stringify({ state, userId: auth.user.id, workspaceId }), { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/google", maxAge: 600 });
  return response;
}
