"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getCapacity, steadyStateNewPerDay, daysToClear } from "@/lib/capacity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Mail, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";

// Enrols a whole campaign onto a sequence, but shows the real qualifying number
// first. In practice a campaign of 558 leads can yield 273 enrolments — half the
// leads have no email at all — and discovering that after the fact is worse than
// seeing it up front.
type Preflight = {
  ready: number;
  noEmail: number;
  multiple: number;
  invalid: number;
  alreadyEnrolled: number;
  total: number;
  steps: number;
  totalEmails: number;
  sampleNoEmail: string[];
  sampleMultiple: { name: string; emails: string[] }[];
};

export function EnrollCampaignDialog({
  campaignId, campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sequenceId, setSequenceId] = useState("");

  const { data: sequences } = useQuery({
    queryKey: ["active-sequences"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("id, name, default_sender_id")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string; default_sender_id: string | null }[];
    },
  });

  const { data: capacity } = useQuery({
    queryKey: ["sending-capacity"],
    enabled: open,
    queryFn: () => getCapacity(supabase),
  });

  const { data: pre, isFetching } = useQuery({
    queryKey: ["enroll-preflight", campaignId, sequenceId],
    enabled: open && !!sequenceId,
    queryFn: async () => {
      const res = await fetch(
        `/api/email/enroll-campaign?campaignId=${campaignId}&sequenceId=${sequenceId}`
      );
      const raw = await res.text();
      let json: Preflight & { error?: string };
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`Server error (${res.status})`);
      }
      if (!res.ok) throw new Error(json.error || "Preflight failed");
      return json as Preflight;
    },
  });

  const enroll = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/email/enroll-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, sequenceId }),
      });
      const raw = await res.text();
      let json: { enrolled?: number; skipped?: number; error?: string };
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`Server error (${res.status}) — nothing was enrolled.`);
      }
      if (!res.ok) throw new Error(json.error || "Enrolment failed");
      return json as { enrolled: number; skipped: number };
    },
    onSuccess: (r) => {
      toast.success(
        `${r.enrolled} lead${r.enrolled === 1 ? "" : "s"} enrolled — the first emails are in Ready to Review`
      );
      setOpen(false);
      setSequenceId("");
      for (const k of ["email-queue", "sending-capacity", "sending-forecast", "lead-enrollments"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const selected = sequences?.find((s) => s.id === sequenceId);
  const noSender = !!selected && !selected.default_sender_id;

  const perDay = capacity ? steadyStateNewPerDay(capacity.cap, pre?.steps || 1) : 0;
  const days = pre && capacity ? daysToClear(pre.ready, capacity.cap, pre.steps || 1) : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="h-4 w-4 mr-1" /> Add to sequence
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enrol {campaignName} on a sequence</DialogTitle>
          <DialogDescription>
            Emails are prepared on schedule and wait in Ready to Review — nothing sends on its own.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Sequence</Label>
            {!sequences?.length ? (
              <p className="text-sm text-muted-foreground">
                No active sequences.{" "}
                <Link href="/settings/email" className="underline">Create one first</Link>.
              </p>
            ) : (
              <Select value={sequenceId} onValueChange={setSequenceId}>
                <SelectTrigger><SelectValue placeholder="Pick a sequence" /></SelectTrigger>
                <SelectContent>
                  {sequences.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {noSender && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
              This sequence has no sender yet. Pick one in{" "}
              <Link href="/settings/email" className="underline">Settings → Email</Link> before enrolling.
            </p>
          )}

          {isFetching && (
            <p className="text-sm text-muted-foreground">Checking leads…</p>
          )}

          {pre && !isFetching && (
            <div className="space-y-3">
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm">
                    <strong className="text-lg tabular-nums">{pre.ready}</strong> of {pre.total} leads
                    will be enrolled
                  </span>
                </div>

                {/* Why the rest are excluded — a bare count invites doubt. */}
                {pre.noEmail > 0 && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      <strong>{pre.noEmail}</strong> have no email address
                      {pre.sampleNoEmail.length > 0 && (
                        <> — e.g. {pre.sampleNoEmail.slice(0, 3).join(", ")}</>
                      )}
                    </span>
                  </div>
                )}
                {pre.multiple > 0 && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      <strong>{pre.multiple}</strong> have more than one email — skipped rather than
                      guessing which person to contact
                      {pre.sampleMultiple.length > 0 && (
                        <> (e.g. {pre.sampleMultiple[0].name})</>
                      )}
                    </span>
                  </div>
                )}
                {pre.invalid > 0 && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span><strong>{pre.invalid}</strong> have an invalid email address</span>
                  </div>
                )}
                {pre.alreadyEnrolled > 0 && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span><strong>{pre.alreadyEnrolled}</strong> are already on this sequence</span>
                  </div>
                )}
              </div>

              {/* What this actually means in time and volume. */}
              {pre.ready > 0 && capacity && (
                <div className="rounded-md border bg-muted/40 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2 font-medium">
                    <Clock className="h-3.5 w-3.5" /> What this means
                  </div>
                  <p className="text-muted-foreground">
                    {pre.ready} leads × {pre.steps} step{pre.steps === 1 ? "" : "s"} ={" "}
                    <strong>{pre.totalEmails} emails</strong> in total.
                  </p>
                  <p className="text-muted-foreground">
                    At today&apos;s cap of {capacity.cap}/day, follow-ups leave room for about{" "}
                    <strong>{perDay} new leads a day</strong> — roughly{" "}
                    <strong>{Number.isFinite(days) ? days : "—"} working days</strong> to work through
                    this campaign.
                  </p>
                  {capacity.warmup_active && (
                    <p className="text-muted-foreground">
                      You&apos;re in warm-up week {capacity.warmup_week} of 5, so the early days are
                      slower and speed up each week.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    Enrolling all of them is safe — the daily cap controls how many actually go out.
                  </p>
                </div>
              )}

              {pre.ready === 0 && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
                  No leads qualify. A lead needs exactly one usable email address to be enrolled.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!pre?.ready || noSender || enroll.isPending}
            onClick={() => enroll.mutate()}
          >
            {enroll.isPending ? "Enrolling…" : `Enrol ${pre?.ready ?? 0} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
