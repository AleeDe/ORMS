"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { todayStr } from "@/lib/dates";
import {
  materializeDue, skipQueueItem, pauseEnrollment, stopForLead, type QueueItem,
} from "@/lib/sequences";
import { formatSlot } from "@/lib/send-window";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Mail, Send, SkipForward, PauseCircle, MessageSquareReply, Pencil, X, HelpCircle,
} from "lucide-react";
import { toneClass } from "@/lib/badge-styles";
import { CapacityPanel } from "@/components/capacity-panel";

// Ready to Review: emails ORMS has PREPARED and a human must SEND. Deliberately
// mirrors the Tasks page — same tab shape, same one-click-per-row rhythm.
export default function EmailsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const today = todayStr();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: "", body: "" });

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
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueItemId: item.id, ...payload }),
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

  const ready = (items ?? []).filter((i) => i.status === "ready");
  const dueToday = ready.filter((i) => i.due_date === today);
  const overdue = ready.filter((i) => i.due_date < today);
  const upcoming = ready.filter((i) => i.due_date > today);
  // Approved but not yet delivered — handed to Resend, waiting for the window.
  const scheduled = (items ?? []).filter((i) => i.status === "approved");
  const sent = (items ?? []).filter((i) => i.status === "sent");
  const other = (items ?? []).filter((i) =>
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
                      <Badge variant="outline">
                        Step {item.step_position} of {item.total_steps}
                      </Badge>
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
                      <Send className="h-4 w-4 mr-1" /> Send
                    </Button>
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
              </CardContent>
            </Card>
          );
        })}
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

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Due Today ({dueToday.length})</TabsTrigger>
          <TabsTrigger value="overdue">Overdue ({overdue.length})</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
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
        <TabsContent value="upcoming" className="mt-4">
          {renderList(upcoming, "Nothing scheduled yet.")}
        </TabsContent>
        <TabsContent value="scheduled" className="mt-4">
          {scheduled.length > 0 && (
            <p className="mb-3 text-sm text-muted-foreground">
              Approved and waiting for your send window. Resend delivers these automatically —
              nothing more to do.
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
