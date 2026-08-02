"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toneClass } from "@/lib/badge-styles";
import { Lightbulb, Clock, ListOrdered } from "lucide-react";

// Which step earns its place, and which hour earns replies.
//
// Step count is the lever people miss: throughput is cap ÷ steps, so dropping a
// step that never gets a reply raises new-lead volume by ~50% on a 3-step
// sequence. That's the decision this panel exists to inform.

type StepStat = {
  sequence_id: string;
  sequence_name: string;
  step_position: number;
  subject: string;
  sent: number;
  replied: number;
  reply_rate: number;
  meetings: number;
};

type HourStat = {
  hour: number;
  sent: number;
  replied: number;
  reply_rate: number;
};

type Summary = {
  sequence_id: string;
  sequence_name: string;
  steps: number;
  enrolled: number;
  active: number;
  completed: number;
  stopped_replied: number;
  stopped_meeting: number;
  emails_sent: number;
  replies: number;
  reply_rate: number;
};

// Below this many sends a rate is noise, not signal — 1 reply from 3 emails is
// not a 33% reply rate in any useful sense.
const MIN_SAMPLE = 20;

export function SequenceAnalytics() {
  const supabase = createClient();

  const { data: steps } = useQuery({
    queryKey: ["sequence-step-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sequence_step_stats");
      if (error) throw error;
      return (data ?? []) as StepStat[];
    },
  });

  const { data: hours } = useQuery({
    queryKey: ["reply-rate-by-hour"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("reply_rate_by_hour", { p_days: 365 });
      if (error) throw error;
      return (data ?? []) as HourStat[];
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["sequence-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sequence_summary");
      if (error) throw error;
      return (data ?? []) as Summary[];
    },
  });

  const withData = (hours ?? []).filter((h) => h.sent > 0);
  const credible = withData.filter((h) => h.sent >= MIN_SAMPLE);
  const bestHour = credible.length
    ? credible.reduce((b, h) => (h.reply_rate > b.reply_rate ? h : b))
    : null;
  const maxRate = Math.max(1, ...withData.map((h) => h.reply_rate));

  // Steps that have had a fair trial and still produce nothing.
  const deadSteps = (steps ?? []).filter(
    (s) => s.sent >= MIN_SAMPLE && s.replied === 0
  );

  return (
    <div className="space-y-6">
      {/* Sequence-level */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListOrdered className="h-4 w-4" /> Sequences
          </CardTitle>
          <CardDescription>
            Reply rate here counts leads whose sequence stopped because they replied or booked.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sequence</TableHead>
                <TableHead className="text-right">Steps</TableHead>
                <TableHead className="text-right">Enrolled</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Emails</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(summary ?? []).map((s) => (
                <TableRow key={s.sequence_id}>
                  <TableCell className="font-medium">{s.sequence_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.steps}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.enrolled}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.active}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.emails_sent}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.replies}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.enrolled >= MIN_SAMPLE ? `${s.reply_rate}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!summary?.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    No sequences yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Per-step */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Which step earns its place</CardTitle>
          <CardDescription>
            A reply counts for the last step sent before it arrived — the message the lead was
            looking at when they answered.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {deadSteps.length > 0 && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <p className="text-xs text-muted-foreground">
                {deadSteps.map((s) => `Step ${s.step_position} of "${s.sequence_name}"`).join(", ")}{" "}
                {deadSteps.length === 1 ? "has" : "have"} had a fair run with no replies. Removing a
                dead step frees capacity for new leads — with a 3-step sequence that&apos;s roughly
                50% more new leads a day, since throughput is your daily cap divided by the number
                of steps.
              </p>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sequence</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Meetings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(steps ?? []).map((s) => (
                <TableRow key={`${s.sequence_id}-${s.step_position}`}>
                  <TableCell className="text-muted-foreground">{s.sequence_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.step_position}</Badge>
                  </TableCell>
                  <TableCell className="max-w-64 truncate">{s.subject}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.sent}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.replied}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.sent >= MIN_SAMPLE ? (
                      <Badge className={toneClass(s.reply_rate >= 5 ? "green" : s.reply_rate > 0 ? "amber" : "slate")}>
                        {s.reply_rate}%
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">too few</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.meetings}</TableCell>
                </TableRow>
              ))}
              {!steps?.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    No sequence emails sent yet — this fills in once you start sending.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Best hour */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" /> When replies actually come
          </CardTitle>
          <CardDescription>
            Every logged email send, by hour in your timezone — use it to tune your outreach window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {bestHour && (
            <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              Best so far: <strong>{String(bestHour.hour).padStart(2, "0")}:00</strong> at{" "}
              {bestHour.reply_rate}% ({bestHour.replied} of {bestHour.sent}).
            </p>
          )}

          {withData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sends logged yet.</p>
          ) : (
            <div className="space-y-1">
              {withData.map((h) => {
                const thin = h.sent < MIN_SAMPLE;
                return (
                  <div key={h.hour} className="flex items-center gap-2 text-xs">
                    <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                      {String(h.hour).padStart(2, "0")}:00
                    </span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className={thin ? "h-full bg-muted-foreground/30" : "h-full bg-primary/70"}
                        style={{ width: `${(h.reply_rate / maxRate) * 100}%` }}
                      />
                    </div>
                    <span className="w-32 shrink-0 text-right tabular-nums text-muted-foreground">
                      {h.replied}/{h.sent}
                      {thin ? " (too few)" : ` · ${h.reply_rate}%`}
                    </span>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-muted-foreground">
                Hours with fewer than {MIN_SAMPLE} sends are greyed out — a couple of replies from a
                handful of emails is noise, not a pattern.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
