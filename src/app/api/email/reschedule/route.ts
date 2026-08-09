import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rescheduleEmail, cancelEmail } from "@/lib/resend";
import { getKeyForDomain } from "@/lib/email-accounts";

// Moves or cancels an email that has already been approved and handed to Resend.
//
// Approving is not sending: while an email sits in the Scheduled tab it is held
// by Resend with a delivery time, and both of those are still changeable
// (verified against the live API — PATCH /emails/:id accepts scheduled_at, and
// POST /emails/:id/cancel exists). Once delivered, Resend answers 404 and there
// is nothing to move, which is reported as "already delivered" rather than as a
// raw provider error.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { queueItemId, sendAt, cancel } = (await req.json()) as {
    queueItemId?: string;
    sendAt?: string;
    cancel?: boolean;
  };
  if (!queueItemId) {
    return NextResponse.json({ error: "queueItemId is required" }, { status: 400 });
  }
  if (!cancel && !sendAt) {
    return NextResponse.json({ error: "sendAt is required" }, { status: 400 });
  }

  // RLS scopes this to the signed-in user.
  const { data: item } = await supabase
    .from("email_queue")
    .select("id, status, resend_message_id, sender_id, enrollment_id, step_position")
    .eq("id", queueItemId)
    .maybeSingle();

  if (!item) return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
  if (item.status !== "approved" || !item.resend_message_id) {
    return NextResponse.json(
      {
        error:
          item.status === "sent"
            ? "This email has already been delivered."
            : `Only scheduled emails can be re-timed (this one is ${item.status}).`,
      },
      { status: 409 }
    );
  }

  let when: Date | null = null;
  if (!cancel) {
    when = new Date(sendAt!);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "That send time is not a valid date." }, { status: 400 });
    }
    if (when.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: "Resend can only schedule up to 30 days ahead. Pick an earlier time." },
        { status: 400 }
      );
    }
  }

  // The key belongs to whichever account owns this sender's domain.
  const { data: sender } = await supabase
    .from("email_senders")
    .select("domain_id")
    .eq("id", item.sender_id)
    .maybeSingle();
  if (!sender) {
    return NextResponse.json({ error: "This email has no sender." }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = await getKeyForDomain(sender.domain_id, auth.user.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No Resend account for this domain." },
      { status: 400 }
    );
  }

  try {
    if (cancel) {
      await cancelEmail(apiKey, item.resend_message_id);
    } else {
      await rescheduleEmail(apiKey, item.resend_message_id, when!.toISOString());
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Resend rejected the change";
    // 404 here means it already went out — the window closed between the page
    // load and the click.
    if (/not found/i.test(message)) {
      return NextResponse.json(
        { error: "Too late — Resend has already delivered this email." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (cancel) {
    // Cancelling returns the step to the queue so it can be reviewed again,
    // rather than silently dropping it from the sequence.
    await supabase
      .from("email_queue")
      .update({
        status: "ready",
        scheduled_at: null,
        scheduled_at_override: null,
        approved_at: null,
        resend_message_id: null,
      })
      .eq("id", item.id);

    // The send already counted against the daily cap; drop that record so a
    // cancelled email does not consume capacity it never used.
    await supabase.from("email_send_log").delete().eq("queue_item_id", item.id);

    return NextResponse.json({ cancelled: true });
  }

  await supabase
    .from("email_queue")
    .update({
      scheduled_at: when!.toISOString(),
      scheduled_at_override: when!.toISOString(),
    })
    .eq("id", item.id);

  return NextResponse.json({ rescheduled: true, scheduledAt: when!.toISOString() });
}
