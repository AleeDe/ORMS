import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountKey } from "@/lib/email-accounts";
import { createDomain, listDomains } from "@/lib/resend";

// Registers a domain with Resend under a chosen connected account, and stores the
// DNS records the user must publish.
//
// The account matters: a domain lives in exactly one Resend account. If a domain
// is already registered under a DIFFERENT account than the one selected here,
// Resend answers "already registered" — so we detect that case and say which
// account to pick instead, rather than surfacing a confusing error.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    domain?: string;
    accountId?: string;
    region?: string;
  };

  const domain = body.domain
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: "Enter a valid domain, e.g. example.com" }, { status: 400 });
  }
  if (!body.accountId) {
    return NextResponse.json(
      { error: "Pick which Resend account to register this domain under." },
      { status: 400 }
    );
  }

  let apiKey: string;
  try {
    apiKey = await getAccountKey(body.accountId, auth.user.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Account not available" },
      { status: 400 }
    );
  }

  try {
    // If this account already holds the domain, adopt it instead of failing —
    // common when the user registered it in Resend's dashboard first.
    const existing = (await listDomains(apiKey)).data ?? [];
    const already = existing.find((d) => d.name === domain);

    const created = already ?? (await createDomain(apiKey, domain, body.region));

    const { data, error } = await supabase
      .from("email_domains")
      .insert({
        user_id: auth.user.id,
        account_id: body.accountId,
        domain,
        resend_domain_id: created.id,
        status: created.status,
        region: created.region ?? "us-east-1",
        dns_records: created.records ?? [],
        last_checked_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "You've already added that domain in ORMS." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ domain: data, adopted: !!already });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not register domain";

    // Resend's "already registered" means the domain sits in a different account
    // than the key we just used. Point the user at the fix.
    if (/already/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            `Resend says ${domain} is already registered — but not under the account you picked. ` +
            `It belongs to one of your other Resend accounts. Connect that account's API key and select it here, ` +
            `or delete the domain in that Resend account first.`,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
