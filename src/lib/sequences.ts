import { SupabaseClient } from "@supabase/supabase-js";
import { addBusinessDays, format } from "date-fns";

// Email sequence engine.
//
// The rule that governs everything here: ORMS PREPARES emails, a human SENDS
// them. Nothing in this file transmits mail — it only decides what should be
// waiting in the Ready to Review queue and what happens after a user sends.

export type EnrollmentStatus = "active" | "paused" | "completed" | "stopped";
export type QueueStatus =
  | "ready"
  /** Reviewed and handed to the provider, waiting for the send window. */
  | "approved"
  | "sent" | "skipped" | "failed" | "bounced" | "cancelled";

export type SequenceStep = {
  id: string;
  position: number;
  delay_days: number;
  subject: string;
  body_template: string;
};

export type QueueItem = {
  id: string;
  enrollment_id: string;
  lead_id: string;
  campaign_id: string | null;
  person_id: string | null;
  sender_id: string | null;
  step_position: number;
  to_email: string;
  subject: string;
  body: string;
  status: QueueStatus;
  due_date: string;
  sent_at: string | null;
  /** When the provider will deliver it; null means it went immediately. */
  scheduled_at: string | null;
  /** A time the user picked for this one email, overriding the outreach window. */
  scheduled_at_override: string | null;
  edited: boolean;
  business_name: string;
  campaign_name: string | null;
  person_name: string | null;
  sender_name: string | null;
  sender_email: string | null;
  sequence_name: string;
  total_steps: number;
};

/** Merge fields available in subject + body templates. */
export const MERGE_FIELDS = [
  { token: "{{first_name}}", label: "Contact first name (falls back to \"there\")" },
  { token: "{{full_name}}", label: "Contact full name" },
  { token: "{{role}}", label: "Contact role" },
  { token: "{{business_name}}", label: "Lead business name" },
  { token: "{{website}}", label: "Lead website" },
  { token: "{{address}}", label: "Lead address" },
];

/**
 * Client-side preview of the same substitution `render_email_template` does in
 * Postgres. Used for live preview while editing a template; the authoritative
 * render still happens at materialisation time so the queue holds final copy.
 */
export function renderPreview(
  template: string,
  lead: { business_name?: string | null; website?: string | null; address?: string | null; custom_fields?: Record<string, unknown> | null },
  person?: { name?: string | null; role?: string | null } | null
): string {
  let out = template;
  const firstName = (person?.name || "").split(" ")[0];

  const map: Record<string, string> = {
    first_name: firstName || "there",
    full_name: person?.name || "",
    role: person?.role || "",
    business_name: lead.business_name || "",
    website: lead.website || "",
    address: lead.address || "",
  };
  for (const [k, v] of Object.entries(map)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  if (lead.custom_fields) {
    for (const [k, v] of Object.entries(lead.custom_fields)) {
      out = out.split(`{{${k}}}`).join(v == null ? "" : String(v));
    }
  }
  // Anything still unresolved disappears rather than shipping raw {{syntax}}.
  return out.replace(/\{\{[^}]*\}\}/g, "");
}

/**
 * Promotes every due enrollment step into the review queue. Idempotent, so the
 * app calls it on queue load and after each send rather than running a cron.
 */
export async function materializeDue(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("materialize_due_emails");
  if (error) throw error;
  return (data as number) ?? 0;
}

/**
 * Enrolls a lead. The sender is pinned now so every step in this thread comes
 * from the same identity, and step 1 is due after that step's own delay
 * (delay_days = 0 means it lands in today's queue).
 */
export async function enrollLead(
  supabase: SupabaseClient,
  opts: {
    leadId: string;
    sequenceId: string;
    campaignId?: string | null;
    personId?: string | null;
    toEmail: string;
    senderId?: string | null;
  }
) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id;

  const { data: seq, error: seqErr } = await supabase
    .from("email_sequences")
    .select("id, default_sender_id")
    .eq("id", opts.sequenceId)
    .single();
  if (seqErr) throw seqErr;

  const { data: firstStep } = await supabase
    .from("email_sequence_steps")
    .select("delay_days")
    .eq("sequence_id", opts.sequenceId)
    .eq("position", 1)
    .maybeSingle();

  if (!firstStep) throw new Error("That sequence has no steps yet.");

  const senderId = opts.senderId ?? seq.default_sender_id;
  if (!senderId) throw new Error("This sequence has no sender. Pick one in Email Settings.");

  const { data, error } = await supabase
    .from("email_enrollments")
    .insert({
      user_id: userId,
      lead_id: opts.leadId,
      campaign_id: opts.campaignId ?? null,
      sequence_id: opts.sequenceId,
      sender_id: senderId,
      person_id: opts.personId ?? null,
      to_email: opts.toEmail,
      current_step: 0,
      next_due_at: format(addBusinessDays(new Date(), firstStep.delay_days), "yyyy-MM-dd"),
      status: "active",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("This lead is already on that sequence.");
    throw error;
  }

  await materializeDue(supabase);
  return data;
}

/**
 * Advances an enrollment after a successful send: records the message id for
 * threading, moves to the next step, and schedules it by that step's delay.
 * Completes the enrollment when no steps remain.
 */
export async function advanceAfterSend(
  supabase: SupabaseClient,
  enrollmentId: string,
  sentStepPosition: number,
  messageId: string | null
) {
  const { data: en, error } = await supabase
    .from("email_enrollments")
    .select("id, sequence_id, root_message_id")
    .eq("id", enrollmentId)
    .single();
  if (error) throw error;

  const { data: nextStep } = await supabase
    .from("email_sequence_steps")
    .select("delay_days")
    .eq("sequence_id", en.sequence_id)
    .eq("position", sentStepPosition + 1)
    .maybeSingle();

  await supabase
    .from("email_enrollments")
    .update({
      current_step: sentStepPosition,
      // The first send anchors the thread; later ones just track the latest id.
      root_message_id: en.root_message_id ?? messageId,
      last_message_id: messageId,
      ...(nextStep
        ? {
            next_due_at: format(addBusinessDays(new Date(), nextStep.delay_days), "yyyy-MM-dd"),
            status: "active" as const,
          }
        : {
            next_due_at: null,
            status: "completed" as const,
            stopped_reason: "completed" as const,
            stopped_at: new Date().toISOString(),
          }),
    })
    .eq("id", enrollmentId);
}

/**
 * Skip this step without sending — advances the sequence exactly as a send would,
 * minus the email.
 */
export async function skipQueueItem(supabase: SupabaseClient, item: QueueItem) {
  await supabase
    .from("email_queue")
    .update({ status: "skipped", skipped_at: new Date().toISOString() })
    .eq("id", item.id);

  await advanceAfterSend(supabase, item.enrollment_id, item.step_position, null);
  await materializeDue(supabase);
}

/** Pause: freezes the enrollment and clears anything already queued for it. */
export async function pauseEnrollment(supabase: SupabaseClient, enrollmentId: string) {
  await supabase
    .from("email_enrollments")
    .update({ status: "paused", next_due_at: null })
    .eq("id", enrollmentId);

  await supabase
    .from("email_queue")
    .update({ status: "cancelled" })
    .eq("enrollment_id", enrollmentId)
    .eq("status", "ready");
}

/** Resume: next step becomes due immediately, then re-materialise. */
export async function resumeEnrollment(supabase: SupabaseClient, enrollmentId: string) {
  await supabase
    .from("email_enrollments")
    .update({ status: "active", next_due_at: format(new Date(), "yyyy-MM-dd") })
    .eq("id", enrollmentId);
  await materializeDue(supabase);
}

/**
 * Stops every active sequence for a lead. This is the manual stop condition —
 * there is no inbox integration, so a reply is marked by hand here (or by
 * quick-logging EMAIL_REPLY / MEETING_BOOKED elsewhere in the app).
 */
export async function stopForLead(
  supabase: SupabaseClient,
  leadId: string,
  reason: "replied" | "meeting_booked" | "manual" | "bounced" | "unsubscribed"
): Promise<number> {
  const { data, error } = await supabase.rpc("stop_enrollments_for_lead", {
    p_lead_id: leadId,
    p_reason: reason,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}
