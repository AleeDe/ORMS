"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, Pencil, Play, PauseCircle, X, AlertTriangle, Clock,
} from "lucide-react";
import { toneClass } from "@/lib/badge-styles";

// Review-and-approve, then let the scheduler send.
//
// Approval is per STEP, not per email. A step is one piece of copy shared by
// every lead in the campaign, so "approve 8,000 emails" is really 8 decisions
// made 1,000 times each. The per-lead grid is still here for spot-checking and
// for excluding individual leads, but it is not the unit of approval.

type Step = {
  id: string;
  position: number;
  delay_days: number;
  subject: string;
  body_template: string;
  approved_at: string | null;
  sequence_id: string;
};

type Summary = {
  total_leads: number;
  active_leads: number;
  paused_leads: number;
  stopped_leads: number;
  completed_leads: number;
  total_emails: number;
  draft_emails: number;
  approved_steps: number;
  total_steps: number;
  sent_emails: number;
  delivered_emails: number;
  opened_emails: number;
  bounced_emails: number;
  replied_leads: number;
};

export function CampaignReview({
  campaignId, sendState,
}: {
  campaignId: string;
  sendState: string;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [previewLead, setPreviewLead] = useState<string>("");

  const { data: summary } = useQuery({
    queryKey: ["campaign-send-summary", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("campaign_send_summary", {
        p_campaign_id: campaignId,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as Summary;
    },
  });

  const { data: steps } = useQuery({
    queryKey: ["campaign-steps", campaignId],
    queryFn: async () => {
      // Steps come from whichever sequences this campaign's leads are on.
      const { data: ens } = await supabase
        .from("email_enrollments")
        .select("sequence_id")
        .eq("campaign_id", campaignId)
        .limit(1000);
      const ids = [...new Set((ens ?? []).map((e) => e.sequence_id))];
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("email_sequence_steps")
        .select("id, position, delay_days, subject, body_template, approved_at, sequence_id")
        .in("sequence_id", ids)
        .order("position");
      if (error) throw error;
      return data as Step[];
    },
  });

  // One real lead so the reviewer sees merge fields resolved, not raw {{tokens}}.
  const { data: sampleEmails } = useQuery({
    queryKey: ["campaign-sample-emails", campaignId, previewLead],
    queryFn: async () => {
      let q = supabase
        .from("email_queue_detail")
        .select("id, step_position, subject, body, business_name, to_email, lead_id")
        .eq("campaign_id", campaignId)
        .order("step_position");
      if (previewLead) q = q.eq("lead_id", previewLead);
      const { data, error } = await q.limit(50);
      if (error) throw error;
      return data as {
        id: string; step_position: number; subject: string; body: string;
        business_name: string; to_email: string; lead_id: string;
      }[];
    },
  });

  const { data: leadOptions } = useQuery({
    queryKey: ["campaign-preview-leads", campaignId],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_queue_detail")
        .select("lead_id, business_name")
        .eq("campaign_id", campaignId)
        .limit(200);
      const seen = new Map<string, string>();
      for (const r of (data ?? []) as { lead_id: string; business_name: string }[]) {
        if (!seen.has(r.lead_id)) seen.set(r.lead_id, r.business_name);
      }
      return [...seen.entries()];
    },
  });

  const invalidate = () => {
    for (const k of [
      "campaign-send-summary", "campaign-steps", "campaign-sample-emails",
      "campaign", "campaign-leads",
    ]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };

  const prepare = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/email/campaign-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, action: "prepare" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not prepare");
      return json as { prepared: number };
    },
    onSuccess: (r) => {
      toast.success(
        r.prepared
          ? `${r.prepared} emails prepared for review`
          : "Already prepared — every step is drafted"
      );
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const approveStep = useMutation({
    mutationFn: async (v: { stepId: string; approved: boolean; edit?: boolean }) => {
      const res = await fetch("/api/email/approve-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: v.stepId,
          approved: v.approved,
          ...(v.edit ? { subject: draft.subject, body: draft.body } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not approve");
      return json as { approved: boolean; rerendered: number };
    },
    onSuccess: (r) => {
      setEditing(null);
      toast.success(
        r.approved
          ? `Step approved${r.rerendered ? ` — ${r.rerendered} emails re-rendered` : ""}`
          : "Approval removed"
      );
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const control = useMutation({
    mutationFn: async (action: "start" | "pause" | "resume") => {
      const res = await fetch("/api/email/campaign-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not change the campaign");
      return json;
    },
    onSuccess: () => { toast.success("Campaign updated"); invalidate(); },
    // The start refusal lists which steps still need approval, so show it long.
    onError: (e) => toast.error(e.message, { duration: 9000 }),
  });

  const allApproved =
    !!summary && summary.total_steps > 0 && summary.approved_steps === summary.total_steps;

  function startEdit(s: Step) {
    setEditing(s.id);
    setDraft({ subject: s.subject, body: s.body_template });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Review &amp; approve</CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={toneClass(
              sendState === "running" ? "green" : sendState === "paused" ? "amber" : "slate"
            )}>
              {sendState}
            </Badge>
            {sendState === "draft" && (
              <>
                <Button size="sm" variant="outline" onClick={() => prepare.mutate()}
                  disabled={prepare.isPending}>
                  Prepare emails
                </Button>
                <Button size="sm" disabled={!allApproved || control.isPending}
                  onClick={() => control.mutate("start")}>
                  <Play className="h-4 w-4 mr-1" /> Start campaign
                </Button>
              </>
            )}
            {sendState === "running" && (
              <Button size="sm" variant="outline" onClick={() => control.mutate("pause")}>
                <PauseCircle className="h-4 w-4 mr-1" /> Pause
              </Button>
            )}
            {sendState === "paused" && (
              <Button size="sm" onClick={() => control.mutate("resume")}>
                <Play className="h-4 w-4 mr-1" /> Resume
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 text-sm">
              {[
                ["Leads", summary.total_leads],
                ["Emails", summary.total_emails],
                ["Awaiting send", summary.draft_emails],
                ["Sent", summary.sent_emails],
                ["Opened", summary.opened_emails],
                ["Replied", summary.replied_leads],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          )}

          {summary && summary.total_emails === 0 && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
              No emails prepared yet. Click <strong>Prepare emails</strong> to build every step
              for every lead, then review each step below.
            </p>
          )}

          {summary && summary.total_steps > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary.approved_steps} of {summary.total_steps} steps approved.
              {!allApproved && " Every step must be approved before the campaign can start."}
            </p>
          )}

          <ThroughputWarning summary={summary} />
        </CardContent>
      </Card>

      {/* Two columns: not approved on the left, approved on the right. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {[false, true].map((approvedCol) => {
          const list = (steps ?? []).filter((s) => !!s.approved_at === approvedCol);
          return (
            <Card key={String(approvedCol)}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {approvedCol ? (
                    <><CheckCircle2 className="h-4 w-4 text-green-600" /> Approved ({list.length})</>
                  ) : (
                    <><Circle className="h-4 w-4 text-muted-foreground" /> Not approved ({list.length})</>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!list.length && (
                  <p className="text-xs text-muted-foreground py-4">
                    {approvedCol ? "Nothing approved yet." : "All steps approved."}
                  </p>
                )}
                {list.map((s) => {
                  const preview = (sampleEmails ?? []).find(
                    (e) => e.step_position === s.position
                  );
                  const isEditing = editing === s.id;
                  return (
                    <div key={s.id} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">Step {s.position}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {s.position === 1
                            ? "sends on start"
                            : `${s.delay_days} business days after the previous step`}
                        </span>
                      </div>

                      {isEditing ? (
                        <div className="space-y-2">
                          <Input
                            value={draft.subject}
                            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                            placeholder="Subject"
                          />
                          <Textarea
                            value={draft.body}
                            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                            rows={10}
                            className="font-mono text-xs"
                          />
                          <p className="text-xs text-muted-foreground">
                            Saving re-renders every unsent email on this step, so what you
                            approve is exactly what goes out.
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-md bg-muted/40 p-2">
                          <p className="text-sm font-medium">
                            {preview?.subject ?? s.subject}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground line-clamp-6">
                            {preview?.body ?? s.body_template}
                          </p>
                          {preview && (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              Previewing {preview.business_name}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {isEditing ? (
                          <>
                            <Button size="sm"
                              onClick={() => approveStep.mutate({ stepId: s.id, approved: true, edit: true })}>
                              Save &amp; approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            {!approvedCol ? (
                              <Button size="sm"
                                onClick={() => approveStep.mutate({ stepId: s.id, approved: true })}>
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve step
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline"
                                onClick={() => approveStep.mutate({ stepId: s.id, approved: false })}>
                                <X className="h-4 w-4 mr-1" /> Un-approve
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => startEdit(s)}>
                              <Pencil className="h-4 w-4 mr-1" /> Edit copy
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Spot-check the copy against any specific lead. */}
      {!!leadOptions?.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Preview against a specific lead</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={previewLead} onValueChange={setPreviewLead}>
              <SelectTrigger className="w-80">
                <SelectValue placeholder="Pick a lead to preview…" />
              </SelectTrigger>
              <SelectContent>
                {leadOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// The finish-date warning. A campaign of this shape can silently run for years,
// and the only honest moment to say so is before it starts.
function ThroughputWarning({ summary }: { summary: Summary | undefined }) {
  const supabase = createClient();
  const { data: capRow } = useQuery({
    queryKey: ["sending-capacity"],
    queryFn: async () => {
      const { data } = await supabase.rpc("sending_capacity_today");
      const row = (Array.isArray(data) ? data[0] : data) as { cap: number } | null;
      // Stamped here because a query result is a side-effecting event; render
      // itself must stay pure.
      return { row, now: Date.now() };
    },
  });
  const cap = capRow?.row ?? null;
  const now = capRow?.now ?? null;

  const perDay = cap?.cap ?? 0;
  const drafts = summary?.draft_emails ?? 0;

  // Day count is pure arithmetic. The finish DATE needs the clock, so it is
  // stamped when the capacity query resolves (see `now` below) rather than read
  // during render, which would be non-deterministic.
  const days = perDay && drafts ? Math.ceil(drafts / perDay) : 0;
  const years = days / 365;
  const finish = now ? new Date(now + days * 24 * 60 * 60 * 1000) : null;

  if (!summary || !days) return null;

  return (
    <div className={`rounded-md border p-3 text-xs space-y-1 ${
      years > 0.5 ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/40"
    }`}>
      <p className="flex items-center gap-2 font-medium">
        {years > 0.5 ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
        What this means
      </p>
      <p className="text-muted-foreground">
        <strong>{summary.draft_emails.toLocaleString()}</strong> emails still to send at{" "}
        <strong>{perDay}/day</strong> ={" "}
        <strong>{days.toLocaleString()} sending days</strong> — finishing around{" "}
        <strong>
          {finish
            ? finish.toLocaleDateString(undefined, { month: "short", year: "numeric" })
            : "…"}
        </strong>.
      </p>
      {years > 0.5 && (
        <p className="text-muted-foreground">
          That is {years.toFixed(1)} years. Raise the daily cap (a paid Resend plan lifts the
          3,000/month free limit) or cut steps from the sequence before starting.
        </p>
      )}
    </div>
  );
}
