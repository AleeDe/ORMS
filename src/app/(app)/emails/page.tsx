"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { todayStr, formatDueDay } from "@/lib/dates";
import {
  materializeDue, skipQueueItem, pauseEnrollment, stopForLead, type QueueItem,
} from "@/lib/sequences";
import { formatSlot, localInputToUtc, isoToLocalInput } from "@/lib/send-window";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Mail, Send, SkipForward, PauseCircle, MessageSquareReply, Pencil, X, HelpCircle, Clock,
} from "lucide-react";
import { toneClass } from "@/lib/badge-styles";
import { CapacityPanel } from "@/components/capacity-panel";

/** An active enrollment whose next step has not been materialised yet. */
type UpcomingEnrollment = {
  id: string;
  current_step: number;
  next_due_at: string;
  to_email: string;
  sequence_id: string;
  leads: { business_name: string } | null;
  email_sequences: { name: string } | null;
};

// Ready to Review: emails ORMS has PREPARED and a human must SEND. Deliberately
// mirrors the Tasks page — same tab shape, same one-click-per-row rhythm.
export default function EmailsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const today = todayStr();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: "", body: "" });
  // Per-row "send at" overrides, keyed by queue id. Empty means "use the window".
  const [sendAt, setSendAt] = useState<Record<string, string>>({});
  // With several sequences running at once the queue is an undifferentiated
  // list, so you cannot review one campaign's copy at a time.
  const [sequenceFilter, setSequenceFilter] = useState("all");

  // Promote anything that has come due. Idempotent, so running it on every load
  // is how the queue stays current without a cron.
  const { data: materialized } = useQuery({
    queryKey: ["materialize"],
    queryFn: () => materializeDue(supabase),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (materialized && materialized > 0) {
      queryClient.invalidateQueries({ queryKey: ["email-queue"] });
    }
  }, [materialized, queryClient]);

  // Delivery times are stamped in UTC but mean nothing to the user unless shown
  // in the zone their outreach window is defined in.
  const { data: sendTimezone = "UTC" } = useQuery({
    queryKey: ["send-timezone"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("timezone").maybeSingle();
      return data?.timezone || "UTC";
    },
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["email-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_queue_detail")
        .select("*")
        .order("due_date")
        .limit(500);
      if (error) throw error;
      return data as QueueItem[];
    },
  });

  const invalidateAll = () => {
    for (const k of ["email-queue", "tasks", "activities", "campaign-leads", "analytics"]) {
      queryClient.invalidateQueries({ queryKey: [k] });
    }
  };

  const send = useMutation({
    mutationFn: async (item: QueueItem) => {
      const payload =
        editing === item.id ? { subject: draft.subject, body: draft.body } : {};
      // A picked time overrides the outreach window for this one email.
      const chosen = sendAt[item.id];
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queueItemId: item.id,
          ...payload,
          ...(chosen ? { sendAt: localInputToUtc(chosen, sendTimezone) } : {}),
        }),
      });
      const raw = await res.text();
      let json: { error?: string; capReached?: boolean; sequenceCompleted?: boolean; nextDue?: string | null };
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`Server error (${res.status}) — the email was not sent.`);
      }
      if (!res.ok) throw new Error(json.error || "Send failed");
      return json as {
        sequenceCompleted: boolean;
        nextDue: string | null;
        scheduledAt: string | null;
        scheduleReason: "immediate" | "later-today" | "tomorrow";
        timezone: string | null;
      };
    },
    onSuccess: (r) => {
      setEditing(null);
      // Approving is not sending when a window is set, so say which it was.
      const when = r.scheduledAt
        ? `Queued — delivers ${formatSlot(r.scheduledAt, r.timezone || "UTC")}`
        : "Sent";
      toast.success(
        r.sequenceCompleted
          ? `${when}. Sequence finished for this lead.`
          : `${when}. Next step due ${r.nextDue}.`
      );
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["materialize"] });
      queryClient.invalidateQueries({ queryKey: ["sending-capacity"] });
    },
    onError: (e) =>
      // The cap message is long and actionable, so give it time to be read.
      toast.error(e.message, { duration: /limit is used up/.test(e.message) ? 8000 : 4000 }),
  });

  // Approved emails are still held by Resend, so their delivery time can be
  // moved (or the send pulled back entirely) right up until it goes out.
  const reschedule = useMutation({
    mutationFn: async ({ item, cancel }: { item: QueueItem; cancel?: boolean }) => {
      const chosen = sendAt[item.id];
      if (!cancel && !chosen) throw new Error("Pick a new time first.");
      const res = await fetch("/api/email/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queueItemId: item.id,
          ...(cancel
            ? { cancel: true }
            : { sendAt: localInputToUtc(chosen, sendTimezone) }),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not change this email");
      return { ...json, cancel } as { scheduledAt?: string; cancel?: boolean };
    },
    onSuccess: (r) => {
      toast.success(
        r.cancel
          ? "Send cancelled — the email is back in Ready to Review"
          : `Rescheduled — delivers ${formatSlot(r.scheduledAt!, sendTimezone)}`
      );
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["sending-capacity"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const skip = useMutation({
    mutationFn: (item: QueueItem) => skipQueueItem(supabase, item),
    onSuccess: () => {
      toast.success("Skipped — sequence moved to the next step");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const pause = useMutation({
    mutationFn: (item: QueueItem) => pauseEnrollment(supabase, item.enrollment_id),
    onSuccess: () => {
      toast.success("Sequence paused");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  // The manual stop condition: no inbox integration, so the user marks replies.
  const markReplied = useMutation({
    mutationFn: async (item: QueueItem) => {
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("activities").insert({
        user_id: userData.user!.id,
        lead_id: item.lead_id,
        campaign_id: item.campaign_id,
        type: "EMAIL_REPLY",
        content: "Reply received (marked from Ready to Review)",
        channel: "personal_email",
        person_id: item.person_id,
      });
      await stopForLead(supabase, item.lead_id, "replied");
    },
    onSuccess: () => {
      toast.success("Reply logged — sequence stopped for this lead");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  // What is coming but not yet in the queue. Steps are only materialised once
  // they fall due, so without this the page looks empty on a quiet day even
  // though 15 follow-ups land tomorrow — "when is the next one?" had no answer.
  const { data: upcomingEnrollments } = useQuery({
    queryKey: ["upcoming-enrollments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_enrollments")
        .select("id, current_step, next_due_at, to_email, sequence_id, leads(business_name), email_sequences(name)")
        .eq("status", "active")
        .not("next_due_at", "is", null)
        .gt("next_due_at", `${today}T23:59:59`)
        .order("next_due_at")
        .limit(500);
      if (error) throw error;
      return data as unknown as UpcomingEnrollment[];
    },
  });

  // Every sequence represented in the queue, so the filter only ever offers
  // options that would actually return something.
  const sequenceOptions = Array.from(
    new Map(
      [
        ...(items ?? []).map((i) => [i.sequence_id, i.sequence_name] as const),
        ...(upcomingEnrollments ?? []).map(
          (e) => [e.sequence_id, e.email_sequences?.name ?? "Sequence"] as const
        ),
      ].filter(([id]) => !!id)
    )
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const inSequence = (sequenceId: string | null) =>
    sequenceFilter === "all" || sequenceId === sequenceFilter;

  const visible = (items ?? []).filter((i) => inSequence(i.sequence_id));

  const ready = visible.filter((i) => i.status === "ready");
  const dueToday = ready.filter((i) => i.due_date === today);
  const overdue = ready.filter((i) => i.due_date < today);
  // Materialised and waiting, plus enrollments whose step is not yet created.
  const upcomingQueued = ready.filter((i) => i.due_date > today);
  const upcomingPending = (upcomingEnrollments ?? []).filter((e) =>
    inSequence(e.sequence_id)
  );
  // Approved but not yet delivered — handed to Resend, waiting for the window.
  const scheduled = visible.filter((i) => i.status === "approved");
  const sent = visible.filter((i) => i.status === "sent");
  const other = visible.filter((i) =>
    ["skipped", "failed", "bounced", "cancelled"].includes(i.status)
  );

  function startEdit(item: QueueItem) {
    setEditing(item.id);
    setDraft({ subject: item.subject, body: item.body });
  }

  function renderList(list: QueueItem[], emptyMsg: string, actionable = true) {
    if (isLoading) return <p className="text-sm text-muted-foreground py-8">Loading…</p>;
    if (!list.length) return <p className="text-sm text-muted-foreground py-8">{emptyMsg}</p>;

    return (
      <div className="space-y-3">
        {list.map((item) => {
          const isEditing = editing === item.id;
          return (
            <Card key={item.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/leads/${item.lead_id}`}
                        className="font-medium hover:underline"
                      >
                        {item.business_name}
                      </Link>
                      {/* Once handed to Resend this step is done, so "Step 1 of 8"
                          alone reads as "still stuck on step 1". Say which it is. */}
                      <Badge variant="outline">
                        {item.status === "ready"
                          ? `Step ${item.step_position} of ${item.total_steps}`
                          : `Step ${item.step_position} of ${item.total_steps} ${
                              item.status === "sent" ? "sent" : "scheduled"
                            }`}
                      </Badge>
                      {item.status === "approved" && item.step_position < item.total_steps && (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          next: step {item.step_position + 1}
                        </Badge>
                      )}
                      <Badge variant="secondary">{item.sequence_name}</Badge>
                      {item.due_date < today && item.status === "ready" && (
                        <Badge className={toneClass("red")}>Overdue</Badge>
                      )}
                      {item.edited && <Badge variant="outline">Edited</Badge>}
                      {item.status !== "ready" && (
                        <Badge variant="outline" className="capitalize">{item.status}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      To {item.person_name ? `${item.person_name} · ` : ""}
                      {item.to_email}
                      {item.sender_email ? ` · from ${item.sender_email}` : ""}
                      {item.campaign_name ? ` · ${item.campaign_name}` : ""}
                    </p>
                  </div>
                  {/* Shown in the outreach timezone, not the browser's: the user
                      set the window in their own zone, so "delivers 2pm" must
                      mean 2pm there. */}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {item.status === "approved" && item.scheduled_at
                      ? `Delivers ${formatSlot(item.scheduled_at, sendTimezone)}`
                      : item.status === "sent" && item.sent_at
                        ? `Sent ${item.sent_at.slice(0, 10)}`
                        : `Due ${item.due_date}`}
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
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Edits apply to this email only — the sequence template is unchanged.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="text-sm font-medium">{item.subject}</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2">
                      {item.body}
                    </p>
                  </div>
                )}

                {actionable && item.status === "ready" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      onClick={() => send.mutate(item)}
                      disabled={send.isPending}
                    >
                      <Send className="h-4 w-4 mr-1" />
                      {sendAt[item.id] ? "Schedule" : "Send"}
                    </Button>
                    {/* Optional per-email time. Left empty, the outreach window
                        decides — which is still the right default for most. */}
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <Input
                        type="datetime-local"
                        className="h-8 w-52 text-xs"
                        value={sendAt[item.id] ?? ""}
                        onChange={(e) =>
                          setSendAt((s) => ({ ...s, [item.id]: e.target.value }))
                        }
                        title="Leave empty to use your outreach window"
                      />
                      {sendAt[item.id] && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-1"
                          onClick={() =>
                            setSendAt((s) => {
                              const next = { ...s };
                              delete next[item.id];
                              return next;
                            })
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </label>
                    {isEditing ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                        <X className="h-4 w-4 mr-1" /> Cancel edit
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => startEdit(item)}>
                        <Pencil className="h-4 w-4 mr-1" /> Edit
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => skip.mutate(item)}>
                      <SkipForward className="h-4 w-4 mr-1" /> Skip
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => pause.mutate(item)}>
                      <PauseCircle className="h-4 w-4 mr-1" /> Pause sequence
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => markReplied.mutate(item)}
                    >
                      <MessageSquareReply className="h-4 w-4 mr-1" /> Lead replied — stop
                    </Button>
                  </div>
                )}

                {/* Scheduled but not delivered: Resend still holds it, so the
                    time can be moved or the send pulled back. */}
                {item.status === "approved" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> Deliver at
                      <Input
                        type="datetime-local"
                        className="h-8 w-52 text-xs"
                        value={
                          sendAt[item.id] ??
                          (item.scheduled_at
                            ? isoToLocalInput(item.scheduled_at, sendTimezone)
                            : "")
                        }
                        onChange={(e) =>
                          setSendAt((s) => ({ ...s, [item.id]: e.target.value }))
                        }
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!sendAt[item.id] || reschedule.isPending}
                      onClick={() => reschedule.mutate({ item })}
                    >
                      Reschedule
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reschedule.isPending}
                      onClick={() => reschedule.mutate({ item, cancel: true })}
                    >
                      <X className="h-4 w-4 mr-1" /> Cancel send
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // Steps that have not been materialised yet — grouped by the day they fall due
  // so the answer to "when is the next batch?" is the first heading.
  function renderPending(list: UpcomingEnrollment[]) {
    if (!list.length) return null;

    const byDay = new Map<string, UpcomingEnrollment[]>();
    for (const e of list) {
      const day = e.next_due_at.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }

    return (
      <div className="space-y-4">
        {[...byDay.entries()].map(([day, rows]) => (
          <div key={day} className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">{formatDueDay(day, today)}</h3>
              <Badge variant="secondary" className="font-normal">
                {rows.length} email{rows.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="rounded-md border divide-y">
              {rows.slice(0, 50).map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {e.leads?.business_name ?? "Lead"}{" "}
                    <span className="text-muted-foreground">· {e.to_email}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    step {e.current_step + 1} · {e.email_sequences?.name ?? "Sequence"}
                  </span>
                </div>
              ))}
              {rows.length > 50 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  …and {rows.length - 50} more
                </p>
              )}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          These are prepared automatically on the day they fall due — open this page then
          and they appear under Due Today, ready to review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Mail className="h-6 w-6" /> Ready to Review
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ORMS prepares each follow-up on schedule. You review, edit if needed, and send —
            nothing goes out on its own.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/help/email">
              <HelpCircle className="h-4 w-4 mr-1" /> Guide
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/settings/email">Sequences &amp; senders</Link>
          </Button>
        </div>
      </div>

      <CapacityPanel />

      {/* Only worth showing once more than one sequence is in play. */}
      {sequenceOptions.length > 1 && (
        <div className="flex items-center gap-2">
          <Select value={sequenceFilter} onValueChange={setSequenceFilter}>
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sequences</SelectItem>
              {sequenceOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sequenceFilter !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setSequenceFilter("all")}>
              Clear
            </Button>
          )}
        </div>
      )}

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Due Today ({dueToday.length})</TabsTrigger>
          <TabsTrigger value="overdue">Overdue ({overdue.length})</TabsTrigger>
          <TabsTrigger value="upcoming">
            Upcoming ({upcomingQueued.length + upcomingPending.length})
          </TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled ({scheduled.length})</TabsTrigger>
          <TabsTrigger value="sent">Sent ({sent.length})</TabsTrigger>
          <TabsTrigger value="other">Skipped &amp; failed ({other.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-4">
          {renderList(dueToday, "Nothing due today. Enrol leads on a sequence to fill this queue.")}
        </TabsContent>
        <TabsContent value="overdue" className="mt-4">
          {renderList(overdue, "Nothing overdue.")}
        </TabsContent>
        <TabsContent value="upcoming" className="mt-4 space-y-6">
          {/* Already materialised and reviewable, then what is still to come. */}
          {upcomingQueued.length > 0 && renderList(upcomingQueued, "")}
          {renderPending(upcomingPending)}
          {!upcomingQueued.length && !upcomingPending.length && (
            <p className="text-sm text-muted-foreground py-8">
              Nothing queued. Enrol leads on a sequence to fill this up.
            </p>
          )}
        </TabsContent>
        <TabsContent value="scheduled" className="mt-4">
          {scheduled.length > 0 && (
            <p className="mb-3 text-sm text-muted-foreground">
              Approved and waiting for your send window. Resend delivers these automatically —
              nothing more to do. You can still move the time or cancel a send until it goes out.
            </p>
          )}
          {renderList(scheduled, "Nothing waiting to be delivered.", false)}
        </TabsContent>
        <TabsContent value="sent" className="mt-4">
          {renderList(sent, "No emails sent yet.", false)}
        </TabsContent>
        <TabsContent value="other" className="mt-4">
          {renderList(other, "Nothing skipped or failed.", false)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
