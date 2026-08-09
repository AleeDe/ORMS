import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Receives Resend delivery events. Unauthenticated by nature (Resend calls it),
// so it uses the service-role client and looks rows up by Resend's own message
// id — an attacker cannot guess one, and nothing here is destructive.
//
// Configure in Resend: Webhooks → https://<your-domain>/api/email/webhook
export async function POST(req: NextRequest) {
  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const messageId = event.data?.email_id;
  if (!messageId || !event.type) return NextResponse.json({ ok: true });

  const supabase = createAdminClient();
  const { data: item } = await supabase
    .from("email_queue")
    .select("id, lead_id, user_id")
    .eq("resend_message_id", messageId)
    .maybeSingle();

  if (!item) return NextResponse.json({ ok: true });

  const now = new Date().toISOString();

  switch (event.type) {
    case "email.delivered":
      // 'approved' means Resend was holding it for the send window. Delivery is
      // the moment that ends, so promote it to 'sent' — otherwise a scheduled
      // email sits in the Scheduled tab forever even after it has landed, and
      // the Sent tab never shows it.
      await supabase
        .from("email_queue")
        .update({ delivered_at: now, status: "sent", sent_at: now })
        .eq("id", item.id)
        .eq("status", "approved");

      // Already 'sent' (delivered immediately): just stamp the delivery time.
      await supabase
        .from("email_queue")
        .update({ delivered_at: now })
        .eq("id", item.id)
        .is("delivered_at", null);
      break;

    case "email.opened":
      // First open only — later opens shouldn't overwrite the original timestamp.
      await supabase
        .from("email_queue")
        .update({ opened_at: now })
        .eq("id", item.id)
        .is("opened_at", null);
      break;

    case "email.bounced":
    case "email.complained": {
      const bounced = event.type === "email.bounced";
      await supabase
        .from("email_queue")
        .update({
          status: bounced ? "bounced" : "sent",
          error: bounced ? "Bounced" : "Marked as spam",
        })
        .eq("id", item.id);

      // A dead address or a spam complaint must stop the sequence — continuing
      // would keep mailing an address that is actively damaging our reputation.
      await supabase
        .from("email_enrollments")
        .update({
          status: "stopped",
          stopped_reason: bounced ? "bounced" : "unsubscribed",
          stopped_at: now,
          next_due_at: null,
        })
        .eq("lead_id", item.lead_id)
        .eq("status", "active");

      await supabase
        .from("email_queue")
        .update({ status: "cancelled" })
        .eq("lead_id", item.lead_id)
        .eq("status", "ready");
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
