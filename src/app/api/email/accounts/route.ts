import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptKey, keyHint } from "@/lib/email-accounts";
import { listDomains, listWebhooks, createWebhook } from "@/lib/resend";

// Connects a Resend account by API key. A user may connect several at once —
// domains live in exactly one Resend account, so pooling accounts is how ORMS
// reaches domains registered under different Resend logins.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Checked up front so a missing secret fails with a clear instruction rather
  // than an opaque crash halfway through.
  if (!process.env.ENCRYPTION_SECRET) {
    // Server misconfiguration, not user error — 500, and name the place the
    // variable actually has to be set for this environment.
    return NextResponse.json(
      {
        error:
          "ENCRYPTION_SECRET is not set on the server, so API keys cannot be stored securely. " +
          "Locally: add it to .env.local. On Vercel: Project → Settings → Environment Variables, " +
          "then redeploy (env changes only apply to new deployments). " +
          "Generate a value with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      },
      { status: 500 }
    );
  }

  const { apiKey, label } = (await req.json()) as { apiKey?: string; label?: string };
  const key = apiKey?.trim();

  if (!key) return NextResponse.json({ error: "Paste your Resend API key." }, { status: 400 });
  if (!key.startsWith("re_")) {
    return NextResponse.json(
      { error: "That doesn't look like a Resend key — they start with \"re_\"." },
      { status: 400 }
    );
  }

  // Verify the key before storing it, and use the response to tell the user
  // which account they just connected.
  let domains: { name: string; status: string }[] = [];
  try {
    const res = await listDomains(key);
    domains = (res.data ?? []).map((d) => ({ name: d.name, status: d.status }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not reach Resend";
    const lower = msg.toLowerCase();

    // Resend answers 500 "Something went wrong" — instead of a 403 — when a key
    // lacks permission for management endpoints like /domains. A "Sending
    // access" key hits this on every call here while still sending mail fine,
    // so the generic message would send the user hunting in the wrong place.
    if (lower.includes("something went wrong") || /resend 5\d\d/.test(lower)) {
      return NextResponse.json(
        {
          error:
            "That key can send email but cannot manage domains — it looks like a \"Sending access\" key. " +
            "ORMS needs a Full access key to register and verify domains. " +
            "In Resend go to API Keys → Create API Key → set Permission to \"Full access\", then paste the new key here.",
        },
        { status: 400 }
      );
    }

    if (lower.includes("api key") || lower.includes("unauthorized")) {
      return NextResponse.json(
        { error: "Resend rejected that key. Check you copied it fully and that it has Full access." },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let encrypted: string;
  try {
    encrypted = encryptKey(key);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Encryption failed" },
      { status: 500 }
    );
  }

  // Service role: api_key_encrypted must never travel through the browser.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_accounts")
    .insert({
      user_id: auth.user.id,
      label: label?.trim() || `Resend account (${domains.length} domains)`,
      api_key_encrypted: encrypted,
      key_hint: keyHint(key),
      domain_count: domains.length,
      last_verified_at: new Date().toISOString(),
    })
    .select("id, label, key_hint, domain_count, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Register the delivery webhook now, while we hold the key. Skipping this is
  // what left 21 delivered emails showing as "Scheduled" — Resend had sent them
  // all, but nothing ever told ORMS, so they never reached the Sent tab.
  // Best-effort: a webhook failure must not undo a working connection.
  let webhookRegistered = false;
  let webhookError: string | null = null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!appUrl || appUrl.includes("localhost")) {
    // Resend cannot reach a local machine, so there is nothing useful to point at.
    webhookError =
      "NEXT_PUBLIC_APP_URL is missing or points at localhost, so delivery tracking is off. " +
      "Set it to your deployed URL and reconnect.";
  } else {
    try {
      const endpoint = `${appUrl}/api/email/webhook`;
      const existing = await listWebhooks(key);
      const already = (existing.data ?? []).some((w) => w.endpoint === endpoint);
      if (!already) await createWebhook(key, endpoint);
      webhookRegistered = true;
    } catch (e) {
      webhookError = e instanceof Error ? e.message : "Could not register the webhook";
    }
  }

  return NextResponse.json({ account: data, domains, webhookRegistered, webhookError });
}

// Disconnect. Cascades to the domains registered under this account, because a
// domain is unusable once its key is gone.
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not set on the server, so accounts cannot be removed. " +
          "On Vercel add it under Project → Settings → Environment Variables and redeploy.",
      },
      { status: 500 }
    );
  }

  const admin = createAdminClient();
  // Ask for the deleted rows back: a wrong service key returns 401, and without
  // this the call looked like a success while nothing was removed.
  const { data, error } = await admin
    .from("email_accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("id");

  if (error) {
    return NextResponse.json(
      {
        error: /invalid api key|jwt/i.test(error.message)
          ? "SUPABASE_SERVICE_ROLE_KEY is wrong on the server — the account could not be removed."
          : error.message,
      },
      { status: 500 }
    );
  }

  if (!data?.length) {
    return NextResponse.json(
      { error: "That account was not found, or it belongs to a different login." },
      { status: 404 }
    );
  }

  return NextResponse.json({ deleted: true });
}
