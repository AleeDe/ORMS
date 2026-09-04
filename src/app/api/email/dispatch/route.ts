import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dispatchDueEmails } from "@/lib/scheduler";

// Runs one scheduling pass: send whatever is approved, due, and within today's
// cap. Safe to call repeatedly — each pass claims a fresh bounded batch, so
// calling it twice sends the next batch rather than re-sending the last.
//
// Called from the campaign screen while a campaign is running, and intended to
// be called by a cron once campaigns are live. Every guard that decides whether
// an email may go out lives in claim_due_emails(), not here.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { maxBatch } = (await req.json().catch(() => ({}))) as { maxBatch?: number };

  try {
    const result = await dispatchDueEmails(
      supabase,
      auth.user.id,
      Math.min(Math.max(maxBatch ?? 25, 1), 100)
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Dispatch failed" },
      { status: 500 }
    );
  }
}
