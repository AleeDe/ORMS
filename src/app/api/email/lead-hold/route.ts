import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Pause or resume one lead's sequence — the "Reply received" column.
//
// A reply is spotted by hand (there is no inbox integration), so pausing must
// be REVERSIBLE and must not lose the lead's position: pausing keeps
// current_step, so resuming continues from the next step rather than restarting
// the sequence. That is why this is a pause with a reason and not `stopped`,
// which is terminal.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { enrollmentId, leadId, action, reason } = (await req.json()) as {
    enrollmentId?: string;
    leadId?: string;
    action?: "pause" | "resume" | "stop";
    reason?: string;
  };
  if (!action || (!enrollmentId && !leadId)) {
    return NextResponse.json(
      { error: "action and one of enrollmentId/leadId are required" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  // Both addressing modes are supported: one enrollment, or every enrollment
  // for a lead (the queue screens know a lead, the campaign screen knows a row).
  const scope = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    enrollmentId ? q.eq("id", enrollmentId) : q.eq("lead_id", leadId!);

  if (action === "pause") {
    const { error } = await scope(
      supabase.from("email_enrollments").update({
        status: "paused",
        paused_reason: reason || "replied",
        paused_at: now,
      })
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // A reply is a real relationship event, so it belongs on the timeline just
    // like a manually logged one.
    if ((reason || "replied") === "replied" && leadId) {
      await supabase.from("activities").insert({
        user_id: auth.user.id,
        lead_id: leadId,
        type: "EMAIL_REPLY",
        content: "Reply received — sequence paused",
        channel: "personal_email",
      });
    }
    return NextResponse.json({ status: "paused" });
  }

  if (action === "resume") {
    const { error } = await scope(
      supabase.from("email_enrollments").update({
        status: "active",
        paused_reason: null,
        paused_at: null,
      })
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "active" });
  }

  const { error } = await scope(
    supabase.from("email_enrollments").update({
      status: "stopped",
      stopped_reason: reason || "manual",
      stopped_at: now,
      next_due_at: null,
    })
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Nothing unsent should survive a stop.
  await supabase
    .from("email_queue")
    .update({ status: "cancelled" })
    .eq(enrollmentId ? "enrollment_id" : "lead_id", enrollmentId || leadId!)
    .in("status", ["draft", "ready"]);

  return NextResponse.json({ status: "stopped" });
}
