import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getKeyForDomain } from "@/lib/email-accounts";
import { sendEmail, formatFrom } from "@/lib/resend";

// Sends a real test email from one sender so the user can confirm the whole
// chain works — key, domain verification, DNS, and how the message actually
// looks in an inbox — before enrolling a single lead.
//
// This sends genuine mail, so the recipient defaults to the signed-in user's own
// address and any override is still their choice to make.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { senderId, to } = (await req.json()) as { senderId?: string; to?: string };
  if (!senderId) {
    return NextResponse.json({ error: "Pick a sender to test." }, { status: 400 });
  }

  const recipient = (to?.trim() || auth.user.email || "").trim();
  if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    return NextResponse.json(
      { error: "Enter a valid email address to send the test to." },
      { status: 400 }
    );
  }

  const { data: sender } = await supabase
    .from("email_senders")
    .select(
      "id, local_part, display_name, reply_to, signature, email_domains(id, domain, status)"
    )
    .eq("id", senderId)
    .maybeSingle();

  const domain = sender?.email_domains as unknown as
    | { id: string; domain: string; status: string }
    | undefined;

  if (!sender || !domain) {
    return NextResponse.json({ error: "Sender not found." }, { status: 404 });
  }
  if (domain.status !== "verified") {
    return NextResponse.json(
      {
        error: `${domain.domain} is not verified yet. Publish its DNS records in your DNS provider, then hit Verify on the Domains tab.`,
      },
      { status: 400 }
    );
  }

  let apiKey: string;
  try {
    apiKey = await getKeyForDomain(domain.id, auth.user.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No Resend account for this domain." },
      { status: 400 }
    );
  }

  const address = `${sender.local_part}@${domain.domain}`;
  const body =
    `This is a test email from ORMS.\n\n` +
    `If you're reading this, sending works:\n` +
    `  • Sender:   ${formatFrom(sender.display_name, address)}\n` +
    `  • Domain:   ${domain.domain} (verified)\n` +
    `  • Reply-to: ${sender.reply_to || address}\n\n` +
    `Check how the sender name looks in your inbox, and hit reply to confirm ` +
    `replies land where you expect — that's where your leads' answers will go.\n\n` +
    `No lead was contacted; this was sent only to you.` +
    (sender.signature ? `\n\n${sender.signature}` : "");

  try {
    const sent = await sendEmail(apiKey, {
      from: formatFrom(sender.display_name, address),
      to: recipient,
      subject: `ORMS test — ${address}`,
      text: body,
      replyTo: sender.reply_to || undefined,
    });
    return NextResponse.json({ sent: true, messageId: sent.id, to: recipient, from: address });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    const lower = msg.toLowerCase();

    // Resend answers 500 rather than 403 when a key lacks permission, so name
    // the likely cause instead of surfacing a meaningless "Something went wrong".
    if (lower.includes("something went wrong")) {
      return NextResponse.json(
        {
          error:
            "Resend rejected the request. If this key only has \"Sending access\" it can still send — " +
            "but if this keeps failing, reconnect the account with a Full access key.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
