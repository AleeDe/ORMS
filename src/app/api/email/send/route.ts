import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, formatFrom } from "@/lib/resend";
import { getKeyForDomain } from "@/lib/email-accounts";
import { nextSendSlot, formatSlot } from "@/lib/send-window";

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

  const { queueItemId, subject, body, sendAt } = (await req.json()) as {
    queueItemId?: string;
    subject?: string;
    body?: string;
    /** ISO delivery time chosen for this one email; overrides the window. */
    sendAt?: string;
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

  // Daily cap is a hard stop: refuse rather than silently exceeding it, because
  // going over is what gets a young domain filtered as spam.
  const { data: capRows } = await supabase.rpc("sending_capacity_today");
  const capacity = Array.isArray(capRows) ? capRows[0] : capRows;

  if (capacity && capacity.remaining <= 0) {
    return NextResponse.json(
      {
        error:
          `Today's sending limit is used up (${capacity.used_today}/${capacity.cap}). ` +
          `This email stays in your queue — send it tomorrow.` +
          (capacity.warmup_active
            ? ` You're in warm-up week ${capacity.warmup_week} of 5; the limit rises each week.`
            : ""),
        capReached: true,
      },
      { status: 429 }
    );
  }

  // Work out when this should actually land. Reviewing at 9am should still
  // deliver inside the outreach window, so approving is not the same as sending.
  const { data: settings } = await supabase
    .from("settings")
    .select("outreach_start_time, outreach_end_time, timezone, schedule_in_window, default_followup_days")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  // Count what is already queued for the same window so sends spread out
  // instead of arriving as one burst.
  const { count: pendingScheduled } = await supabase
    .from("email_queue")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.user.id)
    .eq("status", "approved")
    .gte("scheduled_at", new Date().toISOString());

  // A per-email override wins over the outreach window — the user picked this
  // time deliberately for this one lead. Everything else still spreads across
  // the window, so one override cannot bunch the rest into a burst.
  const override = sendAt?.trim() || item.scheduled_at_override || null;

  let slot: { scheduledAt: string | null; reason: "immediate" | "later-today" | "tomorrow" };
  if (override) {
    const when = new Date(override);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "That send time is not a valid date." }, { status: 400 });
    }
    // Resend refuses anything beyond 30 days with a 422; catch it here so the
    // user gets a sentence instead of a provider error.
    const maxAhead = Date.now() + 30 * 24 * 60 * 60 * 1000;
    if (when.getTime() > maxAhead) {
      return NextResponse.json(
        { error: "Resend can only schedule up to 30 days ahead. Pick an earlier time." },
        { status: 400 }
      );
    }
    // A time already past means "send now" rather than an error.
    slot =
      when.getTime() <= Date.now()
        ? { scheduledAt: null, reason: "immediate" }
        : { scheduledAt: when.toISOString(), reason: "later-today" };
  } else if (settings) {
    slot = nextSendSlot(
      {
        outreach_start_time: settings.outreach_start_time,
        outreach_end_time: settings.outreach_end_time,
        timezone: settings.timezone,
        schedule_in_window: settings.schedule_in_window ?? true,
      },
      pendingScheduled ?? 0
    );
  } else {
    slot = { scheduledAt: null, reason: "immediate" };
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
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: msg }, { status: 500 });
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
      // Resend holds it until the window rather than us running a cron.
      scheduledAt: slot.scheduledAt || undefined,
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
      // 'approved' means reviewed and handed to Resend, but not delivered yet.
      status: slot.scheduledAt ? "approved" : "sent",
      approved_at: new Date().toISOString(),
      scheduled_at: slot.scheduledAt,
      scheduled_at_override: override,
      sent_at: slot.scheduledAt ? null : new Date().toISOString(),
      resend_message_id: messageId,
      subject: finalSubject,
      body: finalBody,
      edited: finalSubject !== item.subject || finalBody !== item.body,
      error: null,
    })
    .eq("id", item.id);

  // Append-only record of what actually reached the provider. Capacity is counted
  // from this rather than from email_queue, whose rows get edited and cancelled.
  await supabase.from("email_send_log").insert({
    user_id: auth.user.id,
    domain_id: domain.id,
    queue_item_id: item.id,
    lead_id: item.lead_id,
    step_position: item.step_position,
    is_followup: item.step_position > 1,
    resend_message_id: messageId,
  });

  // Warm-up starts at the first real send, not at domain verification — a domain
  // sitting idle for a week has built no reputation.
  await supabase
    .from("email_domains")
    .update({ warmup_started_on: new Date().toISOString().slice(0, 10) })
    .eq("id", domain.id)
    .is("warmup_started_on", null);

  // --- Reuse the existing quick-log rules (PRD §12.2) ---------------------
  // Step 1 is an initial send; every later step is a follow-up.
  const action = item.step_position === 1 ? "EMAIL_SENT" : "FOLLOWUP_SENT";

  // settings was already fetched above for the send window.
  const followupDays = settings?.default_followup_days ?? 3;

  // Fetched here rather than after the activity insert because the timeline entry
  // below needs the sequence name too.
  const { data: enrollment } = await supabase
    .from("email_enrollments")
    .select("id, sequence_id, root_message_id, email_sequences(name)")
    .eq("id", item.enrollment_id)
    .single();

  // The timeline is the relationship memory, so record enough to reconstruct the
  // touch without opening the queue: which sequence and step, who it went to, and
  // which identity sent it. "Email sent" alone loses the thread once a lead is on
  // several sequences from different domains.
  const sequenceName = (enrollment as unknown as {
    email_sequences: { name: string } | null;
  })?.email_sequences?.name;
  const sequenceLabel = sequenceName ? `${sequenceName} · ` : "";
  // Approving is not delivering, so the timeline must not imply the mail has
  // landed — say when it is due out, in the user's own timezone.
  const timing = slot.scheduledAt
    ? ` — scheduled for ${formatSlot(slot.scheduledAt, settings?.timezone || "UTC")}`
    : "";

  await supabase.from("activities").insert({
    user_id: auth.user.id,
    lead_id: item.lead_id,
    campaign_id: item.campaign_id,
    type: action,
    content:
      `${sequenceLabel}step ${item.step_position}: "${finalSubject}" ` +
      `→ ${item.to_email} (from ${address})${timing}`,
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
  // `enrollment` was already fetched above for the timeline entry.
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
    // So the UI can say "queued for 1:07pm" instead of implying it already went.
    scheduledAt: slot.scheduledAt,
    scheduleReason: slot.reason,
    timezone: settings?.timezone ?? null,
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
