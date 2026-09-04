import { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, formatFrom } from "@/lib/resend";
import { getKeyForDomain } from "@/lib/email-accounts";
import { nextSendSlot, type WindowSettings } from "@/lib/send-window";

// The scheduler: decides which approved emails go out now, and dispatches them.
//
// This is the piece that replaced "a human clicks Send on every email". The
// human judgement did not disappear — it moved earlier. Nothing here can send
// an email unless ALL of these are true, and every one is enforced in
// claim_due_emails() rather than trusted to the caller:
//
//   * the campaign has been explicitly started (send_state = 'running')
//   * the step's copy carries an approved_at
//   * the lead is active — a paused ("replied") lead is skipped
//   * the previous step actually sent, and its delay has elapsed
//
// It is deliberately pull-based and idempotent: each run claims a bounded batch,
// so running it twice sends the next batch rather than double-sending the last.

export type DispatchResult = {
  attempted: number;
  sent: number;
  failed: number;
  capReached: boolean;
  cap: number;
  usedToday: number;
  errors: { queueItemId: string; error: string }[];
};

type Claimed = {
  id: string;
  enrollment_id: string;
  lead_id: string;
  campaign_id: string | null;
  step_position: number;
  to_email: string;
};

/**
 * Runs one scheduling pass for the signed-in user.
 *
 * `maxBatch` bounds a single invocation so a run can never spend the whole
 * day's allowance in one burst; the daily cap is still the real ceiling.
 */
export async function dispatchDueEmails(
  supabase: SupabaseClient,
  userId: string,
  maxBatch = 25
): Promise<DispatchResult> {
  const result: DispatchResult = {
    attempted: 0, sent: 0, failed: 0,
    capReached: false, cap: 0, usedToday: 0, errors: [],
  };

  // The daily cap is a hard stop, not a target. Exceeding it is what gets a
  // young domain filtered as spam, so it binds before anything else happens.
  const { data: capRows } = await supabase.rpc("sending_capacity_today");
  const capacity = Array.isArray(capRows) ? capRows[0] : capRows;
  result.cap = capacity?.cap ?? 0;
  result.usedToday = capacity?.used_today ?? 0;

  const remaining = capacity?.remaining ?? 0;
  if (remaining <= 0) {
    result.capReached = true;
    return result;
  }

  const budget = Math.min(remaining, maxBatch);

  const { data: claimed, error: claimErr } = await supabase.rpc("claim_due_emails", {
    p_limit: budget,
  });
  if (claimErr) throw claimErr;

  const batch = (claimed ?? []) as Claimed[];
  result.attempted = batch.length;
  if (!batch.length) return result;

  // Send-window settings are per user, so fetch once for the whole batch.
  const { data: settings } = await supabase
    .from("settings")
    .select("outreach_start_time, outreach_end_time, timezone, schedule_in_window")
    .eq("user_id", userId)
    .maybeSingle();

  // How many are already booked into the window, so this batch lands spread out
  // rather than as one burst of identical timestamps.
  const { count: alreadyScheduled } = await supabase
    .from("email_queue")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "approved")
    .gte("scheduled_at", new Date().toISOString());

  let spread = alreadyScheduled ?? 0;

  for (const item of batch) {
    try {
      await dispatchOne(supabase, userId, item, settings as WindowSettings | null, spread);
      spread += 1;
      result.sent += 1;
    } catch (e) {
      result.failed += 1;
      const message = e instanceof Error ? e.message : "Send failed";
      result.errors.push({ queueItemId: item.id, error: message });
      // Record the failure on the row so it stops being claimed forever.
      await supabase
        .from("email_queue")
        .update({ status: "failed", error: message })
        .eq("id", item.id);
    }
  }

  return result;
}

/** Sends one claimed email and advances its enrollment. */
async function dispatchOne(
  supabase: SupabaseClient,
  userId: string,
  claimed: Claimed,
  settings: WindowSettings | null,
  spread: number
): Promise<void> {
  const { data: item } = await supabase
    .from("email_queue")
    .select("*")
    .eq("id", claimed.id)
    .maybeSingle();

  // Re-check the status: another run (or a manual send) may have taken it in
  // the moment between claiming and dispatching.
  if (!item || item.status !== "draft") return;

  const { data: sender } = await supabase
    .from("email_senders")
    .select("id, local_part, display_name, reply_to, signature, domain_id, email_domains(id, domain, status)")
    .eq("id", item.sender_id)
    .maybeSingle();

  const domain = sender?.email_domains as unknown as
    | { id: string; domain: string; status: string }
    | undefined;

  if (!sender || !domain) throw new Error("This email has no sender.");
  if (domain.status !== "verified") {
    throw new Error(`${domain.domain} is not verified.`);
  }

  const address = `${sender.local_part}@${domain.domain}`;
  const finalBody = sender.signature
    ? `${item.body}\n\n${sender.signature}`
    : item.body;

  const slot =
    item.scheduled_at_override
      ? { scheduledAt: item.scheduled_at_override, reason: "later-today" as const }
      : settings
        ? nextSendSlot(
            {
              outreach_start_time: settings.outreach_start_time,
              outreach_end_time: settings.outreach_end_time,
              timezone: settings.timezone,
              schedule_in_window: settings.schedule_in_window ?? true,
            },
            spread
          )
        : { scheduledAt: null, reason: "immediate" as const };

  const apiKey = await getKeyForDomain(domain.id, userId);

  const sent = await sendEmail(apiKey, {
    from: formatFrom(sender.display_name, address),
    to: item.to_email,
    subject: item.subject,
    text: finalBody,
    replyTo: sender.reply_to || undefined,
    inReplyTo: item.in_reply_to || undefined,
    scheduledAt: slot.scheduledAt || undefined,
  });

  const now = new Date().toISOString();

  await supabase
    .from("email_queue")
    .update({
      status: slot.scheduledAt ? "approved" : "sent",
      approved_at: now,
      scheduled_at: slot.scheduledAt,
      sent_at: slot.scheduledAt ? null : now,
      resend_message_id: sent.id,
      body: finalBody,
      error: null,
    })
    .eq("id", item.id);

  // Append-only consumption record — this, not email_queue, is what the daily
  // cap counts.
  await supabase.from("email_send_log").insert({
    user_id: userId,
    domain_id: domain.id,
    queue_item_id: item.id,
    lead_id: item.lead_id,
    step_position: item.step_position,
    is_followup: item.step_position > 1,
    resend_message_id: sent.id,
  });

  // Warm-up starts at the first real send, not at domain verification.
  await supabase
    .from("email_domains")
    .update({ warmup_started_on: now.slice(0, 10) })
    .eq("id", domain.id)
    .is("warmup_started_on", null);

  // --- Timeline + campaign touch, matching the manual send path -------------
  const { data: enrollment } = await supabase
    .from("email_enrollments")
    .select("id, sequence_id, root_message_id, email_sequences(name)")
    .eq("id", item.enrollment_id)
    .single();

  const sequenceName = (enrollment as unknown as {
    email_sequences: { name: string } | null;
  })?.email_sequences?.name;

  await supabase.from("activities").insert({
    user_id: userId,
    lead_id: item.lead_id,
    campaign_id: item.campaign_id,
    type: item.step_position === 1 ? "EMAIL_SENT" : "FOLLOWUP_SENT",
    content:
      `${sequenceName ? `${sequenceName} · ` : ""}step ${item.step_position}: ` +
      `"${item.subject}" → ${item.to_email} (from ${address}) — sent automatically`,
    channel: "personal_email",
    person_id: item.person_id,
  });

  if (item.campaign_id) {
    const { data: cl } = await supabase
      .from("campaign_leads")
      .select("id, touch_count")
      .eq("campaign_id", item.campaign_id)
      .eq("lead_id", item.lead_id)
      .maybeSingle();
    if (cl) {
      await supabase
        .from("campaign_leads")
        .update({ touch_count: cl.touch_count + 1, last_contacted_at: now })
        .eq("id", cl.id);
    }
  }

  // --- Advance the enrollment ----------------------------------------------
  const { data: nextStep } = await supabase
    .from("email_sequence_steps")
    .select("delay_days")
    .eq("sequence_id", enrollment!.sequence_id)
    .eq("position", item.step_position + 1)
    .maybeSingle();

  await supabase
    .from("email_enrollments")
    .update({
      current_step: item.step_position,
      root_message_id: enrollment!.root_message_id ?? sent.id,
      last_message_id: sent.id,
      ...(nextStep
        ? { status: "active" }
        : {
            status: "completed",
            stopped_reason: "completed",
            stopped_at: now,
            next_due_at: null,
          }),
    })
    .eq("id", item.enrollment_id);
}
