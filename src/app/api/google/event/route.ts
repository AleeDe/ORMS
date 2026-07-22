import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCalendarEvent } from "@/lib/google-calendar";

// Creates a calendar event for the signed-in user. Called after a meeting is
// booked or a task is added, when the user has Google Calendar connected.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    title: string;
    description?: string;
    location?: string;
    start: string; // ISO
    end?: string;
    allDay?: boolean;
  };
  if (!body.title || !body.start) {
    return NextResponse.json({ error: "title and start are required" }, { status: 400 });
  }

  try {
    const result = await createCalendarEvent(data.user.id, {
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
