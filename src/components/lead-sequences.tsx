"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  enrollLead, pauseEnrollment, resumeEnrollment, stopForLead,
} from "@/lib/sequences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Mail, PauseCircle, PlayCircle, X } from "lucide-react";
import { toneClass, enrollmentTone } from "@/lib/badge-styles";

type Props = {
  leadId: string;
  campaignId?: string | null;
  /** Addresses on this lead, from lead_emails + decision_makers. */
  emails: { email: string; personId?: string | null; label?: string }[];
};

// Enrol a lead on a sequence and manage its state from Lead Detail. Enrolling
// only SCHEDULES emails — they land in Ready to Review for a human to send.
export function LeadSequences({ leadId, campaignId, emails }: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [sequenceId, setSequenceId] = useState("");
  const [toEmail, setToEmail] = useState(emails[0]?.email ?? "");

  const { data: enrollments } = useQuery({
    queryKey: ["lead-enrollments", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_enrollments")
        .select("id, status, current_step, next_due_at, stopped_reason, to_email, email_sequences(name)")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as {
        id: string; status: string; current_step: number; next_due_at: string | null;
        stopped_reason: string | null; to_email: string;
        email_sequences: { name: string } | null;
      }[];
    },
  });

  const { data: sequences } = useQuery({
    queryKey: ["active-sequences"],
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lead-enrollments", leadId] });
    qc.invalidateQueries({ queryKey: ["email-queue"] });
  };

  const enroll = useMutation({
    mutationFn: async () => {
      const picked = emails.find((e) => e.email === toEmail);
      return enrollLead(supabase, {
        leadId,
        sequenceId,
        campaignId: campaignId ?? null,
        personId: picked?.personId ?? null,
        toEmail,
      });
    },
    onSuccess: () => {
      toast.success("Enrolled — the first email is waiting in Ready to Review");
      setSequenceId("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const pause = useMutation({
    mutationFn: (id: string) => pauseEnrollment(supabase, id),
    onSuccess: () => { toast.success("Paused"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const resume = useMutation({
    mutationFn: (id: string) => resumeEnrollment(supabase, id),
    onSuccess: () => { toast.success("Resumed"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const stop = useMutation({
    mutationFn: () => stopForLead(supabase, leadId, "manual"),
    onSuccess: () => { toast.success("Sequence stopped"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const active = (enrollments ?? []).filter((e) => e.status === "active" || e.status === "paused");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" /> Email sequences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {(enrollments ?? []).map((en) => (
          <div key={en.id} className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{en.email_sequences?.name ?? "Sequence"}</span>
              <Badge className={toneClass(enrollmentTone(en.status))}>{en.status}</Badge>
              {en.stopped_reason && (
                <span className="text-xs text-muted-foreground">({en.stopped_reason})</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {en.current_step} sent to {en.to_email}
              {en.next_due_at ? ` · next due ${en.next_due_at}` : ""}
            </p>
            {(en.status === "active" || en.status === "paused") && (
              <div className="flex gap-1">
                {en.status === "active" ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2"
                    onClick={() => pause.mutate(en.id)}>
                    <PauseCircle className="h-3.5 w-3.5 mr-1" /> Pause
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 px-2"
                    onClick={() => resume.mutate(en.id)}>
                    <PlayCircle className="h-3.5 w-3.5 mr-1" /> Resume
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2"
                  onClick={() => stop.mutate()}>
                  <X className="h-3.5 w-3.5 mr-1" /> Stop
                </Button>
              </div>
            )}
          </div>
        ))}

        {!active.length && (
          <div className="space-y-2 pt-1">
            {!emails.length ? (
              <p className="text-muted-foreground text-xs">
                This lead has no email address — add one to enrol it on a sequence.
              </p>
            ) : !sequences?.length ? (
              <p className="text-muted-foreground text-xs">
                No active sequences.{" "}
                <Link href="/settings/email" className="underline">Create one</Link>.
              </p>
            ) : (
              <>
                <Select value={sequenceId} onValueChange={setSequenceId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Enrol on a sequence…" />
                  </SelectTrigger>
                  <SelectContent>
                    {sequences.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {emails.length > 1 && (
                  <Select value={toEmail} onValueChange={setToEmail}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {emails.map((e) => (
                        <SelectItem key={e.email} value={e.email}>
                          {e.label ? `${e.label} — ${e.email}` : e.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm" className="h-7"
                  disabled={!sequenceId || !toEmail || enroll.isPending}
                  onClick={() => enroll.mutate()}
                >
                  Enrol
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
