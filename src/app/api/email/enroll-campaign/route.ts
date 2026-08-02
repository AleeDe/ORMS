import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Bulk-enrols a campaign's leads onto a sequence.
//
// GET  = preflight: report who qualifies and who doesn't, without changing
//        anything, so the user sees the real number before committing.
// POST = enrol the qualifying leads.
//
// The criteria the user asked for: a lead needs exactly one usable email
// address. No address means nothing to send to; several means we would be
// guessing which person to contact, and guessing wrong on cold outreach is
// worse than skipping the lead.

type LeadRow = {
  lead_id: string;
  leads: {
    business_name: string | null;
    lead_emails: { email: string; is_valid_syntax: boolean | null }[];
    decision_makers: { id: string; email: string | null; personal_email: string | null }[];
  } | null;
};

type Bucket = {
  ready: { leadId: string; email: string; personId: string | null; name: string }[];
  noEmail: string[];
  multiple: { name: string; emails: string[] }[];
  invalid: string[];
  alreadyEnrolled: string[];
};

async function classify(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
  sequenceId: string
): Promise<Bucket> {
  // Page through — campaigns run to hundreds of leads and PostgREST caps a
  // single response.
  const rows: LeadRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("campaign_leads")
      .select(
        "lead_id, leads(business_name, lead_emails(email, is_valid_syntax), decision_makers(id, email, personal_email))"
      )
      .eq("campaign_id", campaignId)
      .range(from, from + 999);
    if (error) throw error;
    const batch = (data ?? []) as unknown as LeadRow[];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }

  // Leads already on this sequence must not be enrolled twice.
  const { data: existing } = await supabase
    .from("email_enrollments")
    .select("lead_id")
    .eq("sequence_id", sequenceId);
  const enrolled = new Set((existing ?? []).map((e) => e.lead_id as string));

  const out: Bucket = {
    ready: [], noEmail: [], multiple: [], invalid: [], alreadyEnrolled: [],
  };

  for (const r of rows) {
    const name = r.leads?.business_name ?? "(unnamed)";

    if (enrolled.has(r.lead_id)) {
      out.alreadyEnrolled.push(name);
      continue;
    }

    const all = r.leads?.lead_emails ?? [];
    const usable = all.filter((e) => e.is_valid_syntax !== false && e.email?.trim());

    if (all.length === 0) {
      out.noEmail.push(name);
    } else if (usable.length === 0) {
      out.invalid.push(name);
    } else if (usable.length > 1) {
      out.multiple.push({ name, emails: usable.map((e) => e.email) });
    } else {
      // Attach a person when one shares this address, so {{first_name}} resolves
      // instead of falling back to "there".
      const addr = usable[0].email.trim();
      const person = (r.leads?.decision_makers ?? []).find(
        (p) =>
          p.email?.trim().toLowerCase() === addr.toLowerCase() ||
          p.personal_email?.trim().toLowerCase() === addr.toLowerCase()
      );
      out.ready.push({
        leadId: r.lead_id,
        email: addr,
        personId: person?.id ?? null,
        name,
      });
    }
  }

  return out;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const campaignId = req.nextUrl.searchParams.get("campaignId");
  const sequenceId = req.nextUrl.searchParams.get("sequenceId");
  if (!campaignId || !sequenceId) {
    return NextResponse.json(
      { error: "campaignId and sequenceId are required" },
      { status: 400 }
    );
  }

  try {
    const b = await classify(supabase, campaignId, sequenceId);
    const { count: steps } = await supabase
      .from("email_sequence_steps")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", sequenceId);

    return NextResponse.json({
      ready: b.ready.length,
      noEmail: b.noEmail.length,
      multiple: b.multiple.length,
      invalid: b.invalid.length,
      alreadyEnrolled: b.alreadyEnrolled.length,
      total:
        b.ready.length + b.noEmail.length + b.multiple.length +
        b.invalid.length + b.alreadyEnrolled.length,
      steps: steps ?? 0,
      totalEmails: b.ready.length * (steps ?? 0),
      // Samples so the user can sanity-check rather than trusting a bare count.
      sampleNoEmail: b.noEmail.slice(0, 5),
      sampleMultiple: b.multiple.slice(0, 5),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Preflight failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { campaignId, sequenceId } = (await req.json()) as {
    campaignId?: string;
    sequenceId?: string;
  };
  if (!campaignId || !sequenceId) {
    return NextResponse.json(
      { error: "campaignId and sequenceId are required" },
      { status: 400 }
    );
  }

  const { data: seq, error: seqErr } = await supabase
    .from("email_sequences")
    .select("id, default_sender_id")
    .eq("id", sequenceId)
    .maybeSingle();
  if (seqErr || !seq) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }
  if (!seq.default_sender_id) {
    return NextResponse.json(
      { error: "That sequence has no sender. Pick one in Settings → Email → Sequences." },
      { status: 400 }
    );
  }

  const { data: firstStep } = await supabase
    .from("email_sequence_steps")
    .select("delay_days")
    .eq("sequence_id", sequenceId)
    .eq("position", 1)
    .maybeSingle();
  if (!firstStep) {
    return NextResponse.json({ error: "That sequence has no steps yet." }, { status: 400 });
  }

  try {
    const b = await classify(supabase, campaignId, sequenceId);
    if (!b.ready.length) {
      return NextResponse.json(
        { error: "No leads in this campaign qualify — none have exactly one usable email." },
        { status: 400 }
      );
    }

    // Step 1 is due immediately; the daily cap controls how many actually go out
    // each day, so enrolling the whole campaign at once is safe.
    const dueAt = new Date().toISOString();

    const rowsToInsert = b.ready.map((r) => ({
      user_id: auth.user!.id,
      lead_id: r.leadId,
      campaign_id: campaignId,
      sequence_id: sequenceId,
      sender_id: seq.default_sender_id,
      person_id: r.personId,
      to_email: r.email,
      current_step: 0,
      next_due_at: dueAt,
      status: "active" as const,
    }));

    let inserted = 0;
    for (let i = 0; i < rowsToInsert.length; i += 500) {
      const chunk = rowsToInsert.slice(i, i + 500);
      const { data, error } = await supabase
        .from("email_enrollments")
        .insert(chunk)
        .select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
    }

    // Materialise so step 1 appears in the review queue straight away.
    await supabase.rpc("materialize_due_emails");

    return NextResponse.json({
      enrolled: inserted,
      skipped: b.noEmail.length + b.multiple.length + b.invalid.length,
      alreadyEnrolled: b.alreadyEnrolled.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Enrolment failed" },
      { status: 500 }
    );
  }
}
