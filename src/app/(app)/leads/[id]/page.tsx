"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  quickLog, QUICK_LOG_LABELS, STATUS_LABELS, STATUS_ORDER, type QuickLogAction,
} from "@/lib/quick-log";
import { todayStr } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Mail, Reply, Phone, PhoneCall, CalendarCheck, StickyNote, Send,
  CheckCircle2, Clock, ExternalLink,
} from "lucide-react";

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  EMAIL_SENT: Mail,
  FOLLOWUP_SENT: Send,
  EMAIL_REPLY: Reply,
  CALL_ATTEMPTED: Phone,
  CALL_CONNECTED: PhoneCall,
  VOICEMAIL: Phone,
  MEETING_BOOKED: CalendarCheck,
  MEETING_COMPLETED: CheckCircle2,
  NOTE_ADDED: StickyNote,
  STATUS_CHANGED: Clock,
};

const ACTIVITY_LABELS: Record<string, string> = {
  EMAIL_SENT: "Email sent",
  FOLLOWUP_SENT: "Follow-up sent",
  EMAIL_REPLY: "Reply received",
  CALL_ATTEMPTED: "Call attempted",
  CALL_CONNECTED: "Call connected",
  VOICEMAIL: "Voicemail left",
  MEETING_BOOKED: "Meeting booked",
  MEETING_COMPLETED: "Meeting completed",
  NOTE_ADDED: "Note",
  STATUS_CHANGED: "Status changed",
};

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [logNote, setLogNote] = useState("");
  const [activeCampaign, setActiveCampaign] = useState<string>("");
  const [noteContent, setNoteContent] = useState("");
  const [noteType, setNoteType] = useState("general");
  const [suggestion, setSuggestion] = useState<{ campaignId: string; to: string } | null>(null);

  const { data: lead } = useQuery({
    queryKey: ["lead", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select(
          "*, lead_emails(*), lead_phones(*), decision_makers(*), datasets(name), campaign_leads(id, status, touch_count, last_contacted_at, campaigns(id, name))"
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: activities } = useQuery({
    queryKey: ["activities", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("*, campaigns(name)")
        .eq("lead_id", id)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: tasks } = useQuery({
    queryKey: ["lead-tasks", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("lead_id", id)
        .order("due_date");
      if (error) throw error;
      return data;
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("*").maybeSingle();
      return data;
    },
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["activities", id] });
    queryClient.invalidateQueries({ queryKey: ["lead-tasks", id] });
    queryClient.invalidateQueries({ queryKey: ["lead", id] });
    // Status / touch changes made here must also refresh campaign & analytics views,
    // otherwise their 30s query cache serves stale filtered lists.
    queryClient.invalidateQueries({ queryKey: ["campaign-leads"] });
    queryClient.invalidateQueries({ queryKey: ["campaign-stats"] });
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    queryClient.invalidateQueries({ queryKey: ["analytics-activities"] });
    queryClient.invalidateQueries({ queryKey: ["analytics-campaigns"] });
    queryClient.invalidateQueries({ queryKey: ["alert-count"] });
    queryClient.invalidateQueries({ queryKey: ["notification-feed"] });
  }

  const doQuickLog = useMutation({
    mutationFn: async (action: QuickLogAction) =>
      quickLog(supabase, {
        leadId: id,
        campaignId: activeCampaign || null,
        action,
        note: logNote,
        followupDays: settings?.default_followup_days ?? 3,
      }),
    onSuccess: (res, action) => {
      toast.success(
        `${QUICK_LOG_LABELS[action]} logged${res.taskCreated ? ` — task: ${res.taskCreated}` : ""}`
      );
      if (res.statusSuggestion && activeCampaign) {
        setSuggestion({ campaignId: activeCampaign, to: res.statusSuggestion });
      }
      setLogNote("");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const applyStatus = useMutation({
    mutationFn: async ({ campaignId, to }: { campaignId: string; to: string }) => {
      const { error } = await supabase
        .from("campaign_leads")
        .update({ status: to })
        .eq("campaign_id", campaignId)
        .eq("lead_id", id);
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("activities").insert({
        user_id: userData.user!.id,
        lead_id: id,
        campaign_id: campaignId,
        type: "STATUS_CHANGED",
        content: `Status → ${STATUS_LABELS[to]}`,
      });
    },
    onSuccess: () => {
      toast.success("Status updated");
      setSuggestion(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user!.id;
      const { error } = await supabase.from("notes").insert({
        user_id: userId, lead_id: id, type: noteType, content: noteContent,
      });
      if (error) throw error;
      await supabase.from("activities").insert({
        user_id: userId, lead_id: id, campaign_id: activeCampaign || null,
        type: "NOTE_ADDED", content: `[${noteType}] ${noteContent}`,
      });
    },
    onSuccess: () => {
      toast.success("Note added");
      setNoteContent("");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const completeTask = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task completed");
      invalidateAll();
    },
  });

  if (!lead) return <p className="text-sm text-muted-foreground">Loading…</p>;

  type CampaignLeadRow = {
    id: string; status: string; touch_count: number;
    campaigns: { id: string; name: string };
  };
  const campaignLeads = (lead.campaign_leads ?? []) as CampaignLeadRow[];
  // Campaign the quick-log status buttons act on: the selected one, or the only one.
  const statusTargetId =
    activeCampaign || (campaignLeads.length === 1 ? campaignLeads[0].campaigns.id : "");
  const statusTarget = campaignLeads.find((cl) => cl.campaigns.id === statusTargetId);

  const pendingTasks = tasks?.filter((t) => t.status === "pending") ?? [];
  const hasOutreach = (activities ?? []).some((a) => a.type !== "NOTE_ADDED" && a.type !== "STATUS_CHANGED");
  const noNextStep = hasOutreach && pendingTasks.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{lead.business_name}</h1>
          {[lead.address, lead.city, lead.country].filter(Boolean).length > 0 && (
            <p className="text-sm text-muted-foreground">
              {[lead.address, lead.city, lead.country].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
        {noNextStep && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="cursor-help text-sm">
                  ⚠ No Next Step
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64">
                You&rsquo;ve contacted this lead but there&rsquo;s no pending follow-up task, so
                nothing will remind you to touch them again. Quick-log an action below (most
                create a follow-up task automatically) to clear this warning.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: info */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Lead Info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {lead.website && (
                <p>
                  <a
                    href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {lead.website} <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              )}
              {lead.datasets?.name && <p>Dataset: {lead.datasets.name}</p>}
              {lead.source && <p className="text-muted-foreground">Source: {lead.source}</p>}
              <div className="flex flex-wrap gap-1 pt-1">
                {lead.tags?.map((t: string) => <Badge key={t} variant="secondary">{t}</Badge>)}
              </div>
              {lead.lead_emails?.length > 0 && (
                <div className="pt-2">
                  <p className="font-medium">Emails</p>
                  {lead.lead_emails.map((e: { id: string; email: string }) => (
                    <p key={e.id} className="text-muted-foreground">{e.email}</p>
                  ))}
                </div>
              )}
              {lead.lead_phones?.length > 0 && (
                <div className="pt-2">
                  <p className="font-medium">Phones</p>
                  {lead.lead_phones.map((p: { id: string; phone: string }) => (
                    <p key={p.id} className="text-muted-foreground">{p.phone}</p>
                  ))}
                </div>
              )}
              {lead.custom_fields && Object.keys(lead.custom_fields).length > 0 && (
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 pt-2">
                  {Object.entries(lead.custom_fields as Record<string, string>).map(([k, v]) => (
                    <p key={k} className="flex justify-between gap-2">
                      <span className="shrink-0 font-medium">{k}</span>
                      <span className="truncate text-right text-muted-foreground" title={String(v)}>
                        {String(v)}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              {lead.decision_makers?.length > 0 && (
                <div className="pt-2">
                  <p className="font-medium">Decision Makers</p>
                  {lead.decision_makers.map((d: { id: string; name: string; role: string | null }) => (
                    <p key={d.id} className="text-muted-foreground">
                      {d.name}{d.role ? ` — ${d.role}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Campaigns</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!lead.campaign_leads?.length && (
                <p className="text-muted-foreground">Not in any campaign yet.</p>
              )}
              {lead.campaign_leads?.map((cl: {
                id: string; status: string; touch_count: number;
                campaigns: { id: string; name: string };
              }) => (
                <div key={cl.id} className="space-y-1">
                  <Link href={`/campaigns/${cl.campaigns.id}`} className="font-medium hover:underline">
                    {cl.campaigns.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    <Select
                      value={cl.status}
                      onValueChange={(v) =>
                        applyStatus.mutate({ campaignId: cl.campaigns.id, to: v })
                      }
                    >
                      <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">{cl.touch_count} touches</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Tasks</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!pendingTasks.length && <p className="text-muted-foreground">No pending tasks.</p>}
              {pendingTasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <div>
                    <p className={t.due_date < todayStr() ? "font-medium text-destructive" : "font-medium"}>
                      {t.title}
                    </p>
                    <p className="text-xs text-muted-foreground">Due {t.due_date}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => completeTask.mutate(t.id)}>
                    Done
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right: quick-log + timeline */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quick Log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(lead.campaign_leads?.length ?? 0) > 0 && (
                <Select value={activeCampaign} onValueChange={setActiveCampaign}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Log against campaign (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {lead.campaign_leads.map((cl: { campaigns: { id: string; name: string } }) => (
                      <SelectItem key={cl.campaigns.id} value={cl.campaigns.id}>
                        {cl.campaigns.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                placeholder="Optional note for the event…"
                value={logNote}
                onChange={(e) => setLogNote(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {(Object.keys(QUICK_LOG_LABELS) as QuickLogAction[]).map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    variant="outline"
                    disabled={doQuickLog.isPending}
                    onClick={() => doQuickLog.mutate(a)}
                  >
                    {QUICK_LOG_LABELS[a]}
                  </Button>
                ))}
              </div>
              {campaignLeads.length > 0 && (
                <div className="space-y-1.5 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Set status{statusTarget ? ` in ${statusTarget.campaigns.name}` : ""}
                    {!statusTargetId && " — select a campaign above first"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_ORDER.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={statusTarget?.status === s ? "default" : "secondary"}
                        disabled={applyStatus.isPending || !statusTargetId || statusTarget?.status === s}
                        onClick={() => applyStatus.mutate({ campaignId: statusTargetId, to: s })}
                      >
                        {STATUS_LABELS[s]}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {suggestion && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2 text-sm">
                  <span>Advance status to <strong>{STATUS_LABELS[suggestion.to]}</strong>?</span>
                  <Button size="sm" onClick={() => applyStatus.mutate({ campaignId: suggestion.campaignId, to: suggestion.to })}>
                    Yes
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>No</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Add Note</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Select value={noteType} onValueChange={setNoteType}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["general", "call", "meeting", "objection", "followup"].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  className="min-h-9 flex-1"
                  placeholder="Write a note…"
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                />
                <Button
                  onClick={() => addNote.mutate()}
                  disabled={!noteContent.trim() || addNote.isPending}
                >
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Relationship Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {!activities?.length ? (
                <p className="text-sm text-muted-foreground">No activity yet — log your first outreach above.</p>
              ) : (
                <div className="space-y-4">
                  {activities.map((a) => {
                    const Icon = ACTIVITY_ICONS[a.type] ?? Clock;
                    return (
                      <div key={a.id} className="flex gap-3">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {ACTIVITY_LABELS[a.type] ?? a.type}
                            {a.campaigns?.name && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {a.campaigns.name}
                              </span>
                            )}
                          </p>
                          {a.content && (
                            <p className="text-sm text-muted-foreground">{a.content}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {new Date(a.occurred_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
