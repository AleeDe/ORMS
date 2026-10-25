import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCalendarEvent } from "@/lib/google-calendar";

// Creates a calendar event for the signed-in user. Called after a meeting is
// booked or a task is added, when the user has Google Calendar connected.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    workspaceId: string;
    title: string; description?: string; location?: string;
    start: string; end?: string; allDay?: boolean;
  };
  if (typeof body.workspaceId !== "string") return NextResponse.json({ error: "Choose a workspace." }, { status: 400 });
  const supabase = await createClient(body.workspaceId);
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: scope } = await supabase.rpc("orms_current_workspace");
  if (scope !== body.workspaceId) return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
  if (!body.title || !body.start) {
    return NextResponse.json({ error: "title and start are required" }, { status: 400 });
  }

  try {
    const result = await createCalendarEvent(data.user.id, scope, {
      title: body.title,
      description: body.description,
      location: body.location,
      start: new Date(body.start),
      end: body.end ? new Date(body.end) : undefined,
      allDay: body.allDay,
    });
    if (!result) return NextResponse.json({ connected: false }, { status: 200 });
    return NextResponse.json({ connected: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "calendar error" },
      { status: 500 }
    );
  }
}
