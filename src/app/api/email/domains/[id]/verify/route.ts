import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getKeyForDomain } from "@/lib/email-accounts";
import { verifyDomain, getDomain } from "@/lib/resend";

// Asks Resend to re-read the domain's DNS and caches the verdict. Resend is the
// authority — this only refreshes our copy of its answer. Verification is async,
// so a domain can read 'pending' here and flip to 'verified' minutes later.
//
// The key is resolved from whichever Resend account this domain was registered
// under, so domains spread across several accounts each verify correctly.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: row } = await supabase
    .from("email_domains")
    .select("id, resend_domain_id")
    .eq("id", id)
    .maybeSingle();

  if (!row?.resend_domain_id) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  try {
    const apiKey = await getKeyForDomain(id, auth.user.id);

    // Kick off verification, then read back the authoritative record.
    await verifyDomain(apiKey, row.resend_domain_id);
    const fresh = await getDomain(apiKey, row.resend_domain_id);

    const { data, error } = await supabase
      .from("email_domains")
      .update({
        status: fresh.status,
        dns_records: fresh.records ?? [],
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ domain: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verification check failed" },
      { status: 500 }
    );
  }
}
