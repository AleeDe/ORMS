import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Campaign run control: build the review grid, start, pause, resume, finish.
//
// Starting is the moment a campaign stops being a draft and the scheduler is
// allowed to send. It refuses to start while any step is still unapproved —
// that check is the whole safety guarantee of the new flow, so it is enforced
// on the server rather than by hiding a button.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { campaignId, action } = (await req.json()) as {
    campaignId?: string;
    action?: "prepare" | "start" | "pause" | "resume" | "finish";
  };
  if (!campaignId || !action) {
    return NextResponse.json({ error: "campaignId and action are required" }, { status: 400 });
  }

  // Build (or top up) the full grid of drafts for review.
  if (action === "prepare") {
    const { data, error } = await supabase.rpc("materialize_campaign_drafts", {
      p_campaign_id: campaignId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ prepared: (data as number) ?? 0 });
  }

  if (action === "start") {
    // Every step whose copy has not been approved blocks the start. Sending
    // unreviewed copy to a whole campaign is exactly what this flow exists to
    // prevent, so this is a hard refusal rather than a warning.
    const { data: enrollments } = await supabase
      .from("email_enrollments")
      .select("sequence_id")
      .eq("campaign_id", campaignId)
      .limit(1000);

    const sequenceIds = [...new Set((enrollments ?? []).map((e) => e.sequence_id))];
    if (!sequenceIds.length) {
      return NextResponse.json(
        { error: "No leads are enrolled on this campaign yet." },
        { status: 400 }
      );
    }

    const { data: steps } = await supabase
      .from("email_sequence_steps")
      .select("id, position, subject, approved_at")
      .in("sequence_id", sequenceIds)
      .order("position");

    const unapproved = (steps ?? []).filter((s) => !s.approved_at);
    if (unapproved.length) {
      return NextResponse.json(
        {
          error:
            `${unapproved.length} step${unapproved.length === 1 ? "" : "s"} still need approval ` +
            `(step ${unapproved.map((s) => s.position).join(", ")}). Review them before starting.`,
          unapprovedSteps: unapproved.map((s) => ({ position: s.position, subject: s.subject })),
        },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ send_state: "running", started_at: new Date().toISOString() })
      .eq("id", campaignId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ started: true });
  }

  const nextState =
    action === "pause" ? "paused" : action === "resume" ? "running" : "finished";

  const { error } = await supabase
    .from("campaigns")
    .update({ send_state: nextState })
    .eq("id", campaignId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ send_state: nextState });
}
