import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, formatFrom } from "@/lib/resend";
import { getKeyForDomain } from "@/lib/email-accounts";

// Sends one reviewed email from the Ready to Review queue. This route only ever
// runs because a human clicked Send — nothing here is triggered on a schedule.
//
// The send is routed through the existing quick-log rules (activity timeline,
// touch count, status suggestion, auto follow-up task) so a sequence email is
// indistinguishable from a manually logged one everywhere else in the app.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { queueItemId, subject, body } = (await req.json()) as {
    queueItemId?: string;
    subject?: string;
    body?: string;
  };
  if (!queueItemId) {
    return NextResponse.json({ error: "queueItemId is required" }, { status: 400 });
  }

  // RLS scopes this to the signed-in user.
  const { data: item, error: itemErr } = await supabase
    .from("email_queue")
    .select("*")
    .eq("id", queueItemId)
    .maybeSingle();
  if (itemErr || !item) {
    return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
  }
  if (item.status !== "ready") {
    return NextResponse.json(
      { error: `This email is already ${item.status}.` },
      { status: 409 }
    );
  }

  // Resolve the pinned sender and refuse to send from an unverified domain —
  // Resend would reject it anyway, and failing here gives a clearer message.
  const { data: sender } = await supabase
    .from("email_senders")
    .select(
      "id, local_part, display_name, reply_to, signature, domain_id, email_domains(id, domain, status)"
    )
    .eq("id", item.sender_id)
    .maybeSingle();

  const domain = sender?.email_domains as unknown as
    | { id: string; domain: string; status: string }
    | undefined;

  if (!sender || !domain) {
    return NextResponse.json(
      { error: "This email has no sender. Pick one in Email Settings." },
      { status: 400 }
    );
  }
  if (domain.status !== "verified") {
    return NextResponse.json(
      { error: `${domain.domain} is not verified yet. Publish its DNS records and verify it first.` },
      { status: 400 }
    );
  }

  const finalSubject = subject?.trim() || item.subject;
  const finalBodyBase = body?.trim() || item.body;
  const finalBody = sender.signature
    ? `${finalBodyBase}\n\n${sender.signature}`
    : finalBodyBase;
  const address = `${sender.local_part}@${domain.domain}`;

  // Resolve the key from whichever Resend account this domain was registered
  // under — domains may be spread across several connected accounts.
  let apiKey: string;
  try {
    apiKey = await getKeyForDomain(domain.id, auth.user.id);
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "No Resend account is connected for this domain.";
    // Server config problems, not something the user can fix from the queue.
    if (msg.includes("ENCRYPTION_SECRET")) {
      return NextResponse.json(
        {
          error:
            "The server is missing ENCRYPTION_SECRET, so stored API keys cannot be read. " +
            "On Vercel add it under Project → Settings → Environment Variables and redeploy.",
        },
        { status: 500 }
      );
    }
    if (/bad decrypt|unable to authenticate|wrong final block/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Stored API keys can't be decrypted — ENCRYPTION_SECRET differs from the one used when the account was connected. " +
            "Restore the original value, or reconnect the Resend account.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let messageId: string;
  try {
    const sent = await sendEmail(apiKey, {
      from: formatFrom(sender.display_name, address),
      to: item.to_email,
      subject: finalSubject,
      text: finalBody,
      replyTo: sender.reply_to || undefined,
      // Threads step 2+ under the original conversation.
      inReplyTo: item.in_reply_to || undefined,
    });
    messageId = sent.id;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Send failed";
    await supabase
      .from("email_queue")
      .update({ status: "failed", error: message })
      .eq("id", item.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Mark sent, storing any edits the user made so the record matches what went out.
  await supabase
    .from("email_queue")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      resend_message_id: messageId,
      subject: finalSubject,
      body: finalBody,
      edited: finalSubject !== item.subject || finalBody !== item.body,
      error: null,
    })
    .eq("id", item.id);

  // --- Reuse the existing quick-log rules (PRD §12.2) ---------------------
  // Step 1 is an initial send; every later step is a follow-up.
  const action = item.step_position === 1 ? "EMAIL_SENT" : "FOLLOWUP_SENT";

  const { data: settings } = await supabase
    .from("settings")
    .select("default_followup_days")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const followupDays = settings?.default_followup_days ?? 3;

  await supabase.from("activities").insert({
    user_id: auth.user.id,
    lead_id: item.lead_id,
    campaign_id: item.campaign_id,
    type: action,
    content: `${finalSubject} (sequence step ${item.step_position})`,
    channel: "personal_email",
    person_id: item.person_id,
  });

  // Touch count + last contacted, matching quickLog's behaviour.
  if (item.campaign_id) {
    const { data: cl } = await supabase
      .from("campaign_leads")
      .select("id, touch_count, status")
      .eq("campaign_id", item.campaign_id)
      .eq("lead_id", item.lead_id)
      .maybeSingle();
    if (cl) {
      await supabase
        .from("campaign_leads")
        .update({
          touch_count: cl.touch_count + 1,
          last_contacted_at: new Date().toISOString(),
        })
        .eq("id", cl.id);
    }
  }

  // --- Advance the sequence ----------------------------------------------
  const { data: enrollment } = await supabase
    .from("email_enrollments")
    .select("id, sequence_id, root_message_id")
    .eq("id", item.enrollment_id)
    .single();

  const { data: nextStep } = await supabase
    .from("email_sequence_steps")
    .select("delay_days")
    .eq("sequence_id", enrollment!.sequence_id)
    .eq("position", item.step_position + 1)
    .maybeSingle();

  const nextDue = nextStep
    ? businessDaysAhead(nextStep.delay_days)
    : null;

  await supabase
    .from("email_enrollments")
    .update({
      current_step: item.step_position,
      root_message_id: enrollment!.root_message_id ?? messageId,
      last_message_id: messageId,
      ...(nextStep
        ? { next_due_at: nextDue, status: "active" }
        : {
            next_due_at: null,
            status: "completed",
            stopped_reason: "completed",
            stopped_at: new Date().toISOString(),
          }),
    })
    .eq("id", item.enrollment_id);

  // Auto follow-up task only when the sequence has ended — while it is running,
  // the next queued email IS the next step, so a task would duplicate it.
  let taskCreated: string | null = null;
  if (!nextStep) {
    const { error: taskErr } = await supabase.from("tasks").insert({
      user_id: auth.user.id,
      lead_id: item.lead_id,
      campaign_id: item.campaign_id,
      type: "followup_email",
      title: "Follow up — sequence finished",
      due_date: businessDaysAhead(followupDays),
    });
    if (!taskErr) taskCreated = "Follow up — sequence finished";
  }

  return NextResponse.json({
    sent: true,
    messageId,
    nextDue,
    sequenceCompleted: !nextStep,
    taskCreated,
  });
}

// Business-day arithmetic, matching lib/dates.ts so a "3 day" delay means the
// same thing here as everywhere else in the app.
function businessDaysAhead(days: number): string {
  const d = new Date();
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}
