import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Approves (or un-approves) one step's copy.
//
// Approval is per STEP because a step is ONE piece of copy shared by every lead
// — approving it per email would be the same decision a thousand times. Editing
// the copy clears the approval, so a changed email can never inherit a review
// that was given to different words.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { stepId, approved, subject, body } = (await req.json()) as {
    stepId?: string;
    approved?: boolean;
    subject?: string;
    body?: string;
  };
  if (!stepId) return NextResponse.json({ error: "stepId is required" }, { status: 400 });

  // An edit arriving with the approval means the user changed the copy in the
  // review screen; save it first so approval applies to what they actually saw.
  const edited = subject !== undefined || body !== undefined;
  if (edited) {
    const { error } = await supabase
      .from("email_sequence_steps")
      .update({
        ...(subject !== undefined ? { subject } : {}),
        ...(body !== undefined ? { body_template: body } : {}),
      })
      .eq("id", stepId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error } = await supabase
    .from("email_sequence_steps")
    .update({
      approved_at: approved ? new Date().toISOString() : null,
      approved_by: approved ? auth.user.id : null,
    })
    .eq("id", stepId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Changed copy invalidates drafts already rendered from the old template.
  // Re-render them so review and delivery cannot diverge.
  let rerendered = 0;
  if (edited) {
    const { data: drafts } = await supabase
      .from("email_queue")
      .select("id, lead_id, person_id")
      .eq("step_id", stepId)
      .eq("status", "draft")
      .limit(5000);

    for (const d of drafts ?? []) {
      const [{ data: subj }, { data: bod }] = await Promise.all([
        supabase.rpc("render_email_template", {
          p_template: subject, p_lead_id: d.lead_id, p_person_id: d.person_id,
        }),
        supabase.rpc("render_email_template", {
          p_template: body, p_lead_id: d.lead_id, p_person_id: d.person_id,
        }),
      ]);
      await supabase
        .from("email_queue")
        .update({
          ...(subject !== undefined ? { subject: subj as string } : {}),
          ...(body !== undefined ? { body: bod as string } : {}),
        })
        .eq("id", d.id);
      rerendered += 1;
    }
  }

  return NextResponse.json({ approved: !!approved, rerendered });
}
