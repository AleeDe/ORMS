"use client";

import { use, useState } from "react";
import Link from "@/components/workspace-link";
import { useSearchParams, useRouter } from "@/lib/workspace-navigation";
import { ArrowLeft } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace, useWorkspaceClient, useWorkspaceDraft } from "@/components/workspace-provider";
import { TaskAssignment } from "@/components/task-assignment";
import { canWork, canChangeTask } from "@/lib/workspace";
import {
  quickLog, QUICK_LOG_LABELS, STATUS_LABELS, STATUS_ORDER, type QuickLogAction,
} from "@/lib/quick-log";
import { todayStr } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CampaignLeadNavigator } from "@/components/campaign-lead-navigator";
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
  CheckCircle2, Clock, ExternalLink, Pencil, Plus, Trash2, ShieldCheck, ArrowUpRight, LockKeyhole,
} from "lucide-react";
import { campaignFromSearch, channelTouchTotals, fetchLeadActivities, leadHref, OUTREACH_TYPES, scopeCampaign } from "@/lib/campaign-scope";
import { normalizeName, normalizePhone, normalizeWebsite } from "@/lib/normalize";
import { AddToCalendar } from "@/components/add-to-calendar";
import { autoCreateGoogleEvent } from "@/lib/calendar";
import { activityClass, dueTone, statusClass, toneClass } from "@/lib/badge-styles";
import {
  CHANNEL_LABELS, CHANNEL_ORDER, ROLE_OPTIONS, personLabel, channelSupportsAction, defaultPersonId, isContactChannel,
  type ContactChannel, type Person,
} from "@/lib/people";

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
  INFO_UPDATED: Pencil,
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
  INFO_UPDATED: "Info updated",
};

type EditForm = {
  business_name: string;
  website: string;
  address: string;
  city: string;
  country: string;
  emails: { id?: string; email: string; original?: string }[];
  phones: { id?: string; phone: string; original?: string }[];
  // custom_fields flattened to editable rows; `originalKey` absent = newly added field
  custom: { key: string; value: string; originalKey?: string }[];
};

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const campaignId = campaignFromSearch(searchParams);
  return <LeadWorkspace key={`${id}:${campaignId ?? "library"}`} id={id} campaignId={campaignId} />;
}

type CampaignLeadRow = {
  id: string; status: string; touch_count: number; last_contacted_at: string | null;
  campaigns: { id: string; name: string; default_channel: ContactChannel | null };
};

function LeadWorkspace({ id, campaignId }: { id: string; campaignId: string | null }) {
  const access = useWorkspace();
  const writable = canWork(access.role(campaignId));
  const router = useRouter();
  const fromCampaign = campaignId;
  const activeCampaign = campaignId ?? "";
  const supabase = useWorkspaceClient();
  const queryClient = useQueryClient();

  const [logNote, setLogNote] = useState("");
  const [logChannel, setLogChannel] = useState<string>("");
  const [logPerson, setLogPerson] = useState<string | null>(null);
  const [personForm, setPersonForm] = useState<Partial<Person> | null>(null);
  const [taskForm, setTaskForm] = useState<{ title: string; due_date: string } | null>(null);
  // When set, the "Meeting Booked" panel is open and we log once a time is chosen.
  const [meetingAt, setMeetingAt] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [noteType, setNoteType] = useState("general");
  const [suggestion, setSuggestion] = useState<{ campaignId: string; to: string } | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  useWorkspaceDraft(Boolean(logNote.trim() || noteContent.trim() || personForm || taskForm || meetingAt || editForm));

  const { data: lead, error: leadError } = useQuery({
    queryKey: ["lead", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select(
          "*, lead_emails!lead_emails_lead_id_fkey(*), lead_phones!lead_phones_lead_id_fkey(*), decision_makers!decision_makers_lead_id_fkey(*), datasets!leads_dataset_id_fkey(name), campaign_leads!campaign_leads_lead_id_fkey(id, status, touch_count, last_contacted_at, campaigns!campaign_leads_campaign_id_fkey(id, name, default_channel))"
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const campaignLeads = (lead?.campaign_leads ?? []) as CampaignLeadRow[];
  const activeMembership = campaignLeads.find((cl) => cl.campaigns.id === campaignId);
  const validScope = !campaignId || !!activeMembership;
  const people = (lead?.decision_makers ?? []) as Person[];
  const fixedChannel = activeMembership?.campaigns.default_channel ?? null;
  const effectiveChannel = fixedChannel ?? (isContactChannel(logChannel) ? logChannel : null);
  const effectivePerson = logPerson ?? defaultPersonId(people);

  const { data: activities, isPending: activitiesLoading, error: activitiesError } = useQuery({
    queryKey: ["activities", id, campaignId],
    enabled: !!lead && validScope,
    queryFn: () => fetchLeadActivities(supabase, id, campaignId),
  });

  const channelTouches = channelTouchTotals(activities ?? []);

  const { data: tasks, error: tasksError } = useQuery({
    queryKey: ["lead-tasks", id, campaignId],
    enabled: !!lead && validScope,
    queryFn: async () => {
      const query = supabase
        .from("tasks")
        .select("*")
        .eq("lead_id", id);
      const { data, error } = await scopeCampaign(query, campaignId).order("due_date");
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
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["no-next-step"] });
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
    queryClient.invalidateQueries({ queryKey: ["channel-touches", id] });
    queryClient.invalidateQueries({ queryKey: ["team-data"] });
  }

  const doQuickLog = useMutation({
    mutationFn: async (vars: { action: QuickLogAction; meetingAt?: string }) =>
      quickLog(supabase, {
        leadId: id,
        campaignId: activeCampaign || null,
        action: vars.action,
        note: logNote,
        followupDays: settings?.default_followup_days ?? 3,
        channel: effectiveChannel,
        personId: effectivePerson || null,
      }),
    onSuccess: (res, vars) => {
      const action = vars.action;
      toast.success(
        `${QUICK_LOG_LABELS[action]} logged${res.taskCreated ? ` — task: ${res.taskCreated}` : ""}`
      );
      res.warnings.forEach((warning) => toast.warning(warning));
      if (res.statusSuggestion) {
        setSuggestion({ campaignId: res.campaignId, to: res.statusSuggestion });
      }
      // A booked meeting goes straight onto the user's Google Calendar at the
      // chosen time (silent if Google isn't connected).
      if (action === "MEETING_BOOKED" && vars.meetingAt) {
        const start = new Date(vars.meetingAt);
        autoCreateGoogleEvent({
          title: `Meeting — ${lead.business_name}`,
          description: logNote || `Meeting with ${lead.business_name}`,
          start,
          end: new Date(start.getTime() + 30 * 60 * 1000),
        }, access.workspace.id).then((added) => {
          if (added) toast.success("Meeting added to Google Calendar");
        });
      }
      setLogNote("");
      setMeetingAt(null);
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
        .eq("lead_id", id).select("id").single();
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      const { error: activityError } = await supabase.from("activities").insert({
        user_id: userData.user!.id,
        lead_id: id,
        campaign_id: campaignId,
        type: "STATUS_CHANGED",
        content: `Status → ${STATUS_LABELS[to]}`,
      });
      if (activityError) throw activityError;
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
      // The timeline is the note's source of truth; the legacy notes table has
      // no campaign column and would turn campaign notes into shared records.
      const { error } = await supabase.from("activities").insert({
        user_id: userId, lead_id: id, campaign_id: activeCampaign || null,
        type: "NOTE_ADDED", content: `[${noteType}] ${noteContent}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Note added");
      setNoteContent("");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  // Every field change is written to the activities timeline (INFO_UPDATED) —
  // edits are allowed, but always logged.
  const saveEdit = useMutation({
    mutationFn: async (form: EditForm) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user!.id;
      const changes: string[] = [];

      const fields: { key: keyof EditForm; label: string }[] = [
        { key: "business_name", label: "Name" },
        { key: "website", label: "Website" },
        { key: "address", label: "Address" },
        { key: "city", label: "City" },
        { key: "country", label: "Country" },
      ];
      const patch: Record<string, string | null> = {};
      for (const f of fields) {
        const next = (form[f.key] as string).trim();
        const prev = (lead[f.key] ?? "") as string;
        if (next !== prev) {
          patch[f.key] = next || null;
          changes.push(`${f.label}: "${prev || "—"}" → "${next || "—"}"`);
        }
      }
      if ("business_name" in patch) patch.name_norm = normalizeName(form.business_name);
      if ("website" in patch) patch.website_norm = normalizeWebsite(form.website);
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("leads").update(patch).eq("id", id);
        if (error) throw error;
      }

      for (const e of form.emails) {
        const val = e.email.trim().toLowerCase();
        if (e.id && !val) {
          const { error } = await supabase.from("lead_emails").delete().eq("id", e.id);
          if (error) throw error;
          changes.push(`Email removed: ${e.original}`);
        } else if (e.id && val !== e.original) {
          const { error } = await supabase.from("lead_emails").update({ email: val }).eq("id", e.id);
          if (error) throw error;
          changes.push(`Email: "${e.original}" → "${val}"`);
        } else if (!e.id && val) {
          const { error } = await supabase
            .from("lead_emails")
            .insert({ user_id: userId, lead_id: id, email: val });
          if (error) throw error;
          changes.push(`Email added: ${val}`);
        }
      }

      for (const p of form.phones) {
        const val = p.phone.trim();
        if (p.id && !val) {
          const { error } = await supabase.from("lead_phones").delete().eq("id", p.id);
          if (error) throw error;
          changes.push(`Phone removed: ${p.original}`);
        } else if (p.id && val !== p.original) {
          const { error } = await supabase
            .from("lead_phones")
            .update({ phone: val, phone_norm: normalizePhone(val) })
            .eq("id", p.id);
          if (error) throw error;
          changes.push(`Phone: "${p.original}" → "${val}"`);
        } else if (!p.id && val) {
          const { error } = await supabase
            .from("lead_phones")
            .insert({ user_id: userId, lead_id: id, phone: val, phone_norm: normalizePhone(val) });
          if (error) throw error;
          changes.push(`Phone added: ${val}`);
        }
      }

      // Custom fields — rebuild the JSON object from the edited rows, diff against
      // the current one so every add / rename / value change / removal is logged.
      const prevCustom = (lead.custom_fields ?? {}) as Record<string, string>;
      const nextCustom: Record<string, string> = {};
      for (const row of form.custom) {
        const key = row.key.trim();
        const value = row.value.trim();
        if (!key) continue; // dropped: blank key
        nextCustom[key] = value;
        if (!row.originalKey) {
          changes.push(`Field added — ${key}: "${value || "—"}"`);
        } else if (row.originalKey !== key) {
          changes.push(`Field renamed: "${row.originalKey}" → "${key}"`);
          if (value !== (prevCustom[row.originalKey] ?? "")) {
            changes.push(`${key}: "${prevCustom[row.originalKey] ?? "—"}" → "${value || "—"}"`);
          }
        } else if (value !== (prevCustom[key] ?? "")) {
          changes.push(`${key}: "${prevCustom[key] ?? "—"}" → "${value || "—"}"`);
        }
      }
      // fields present before but no longer in the form (or blanked key) = removed
      const keptOriginals = new Set(
        form.custom.map((r) => r.originalKey).filter(Boolean) as string[]
      );
      for (const k of Object.keys(prevCustom)) {
        if (!keptOriginals.has(k)) changes.push(`Field removed — ${k}`);
      }
      const customChanged =
        JSON.stringify(prevCustom) !== JSON.stringify(nextCustom);
      if (customChanged) {
        const { error } = await supabase
          .from("leads").update({ custom_fields: nextCustom }).eq("id", id);
        if (error) throw error;
      }

      if (changes.length) {
        const { error } = await supabase.from("activities").insert({
          user_id: userId, lead_id: id, campaign_id: campaignId, type: "INFO_UPDATED", content: changes.join("\n"),
        });
        if (error) throw error;
      }
      return changes.length;
    },
    onSuccess: (count) => {
      toast.success(count ? "Lead updated — changes logged in timeline" : "No changes");
      setEditForm(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  // People attached to this lead — add / edit is logged like any other info change.
  const savePerson = useMutation({
    mutationFn: async (form: Partial<Person>) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user!.id;
      const row = {
        name: (form.name ?? "").trim(),
        role: form.role?.trim() || null,
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        personal_email: form.personal_email?.trim() || null,
        personal_phone: form.personal_phone?.trim() || null,
        linkedin_url: form.linkedin_url?.trim() || null,
        notes: form.notes?.trim() || null,
      };
      if (form.id) {
        const { error } = await supabase
          .from("decision_makers").update(row).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("decision_makers").insert({ ...row, user_id: userId, lead_id: id });
        if (error) throw error;
      }
      const { error: actErr } = await supabase.from("activities").insert({
        user_id: userId, lead_id: id, campaign_id: campaignId, type: "INFO_UPDATED",
        content: `${form.id ? "Person updated" : "Person added"} — ${row.name}${
          row.role ? ` (${row.role})` : ""
        }`,
      });
      if (actErr) throw actErr;
    },
    onSuccess: () => {
      toast.success("Person saved — logged in timeline");
      setPersonForm(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const deletePerson = useMutation({
    mutationFn: async (p: Person) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("decision_makers").delete().eq("id", p.id);
      if (error) throw error;
      const { error: activityError } = await supabase.from("activities").insert({
        user_id: userData.user!.id, lead_id: id, campaign_id: campaignId, type: "INFO_UPDATED",
        content: `Person removed — ${p.name}${p.role ? ` (${p.role})` : ""}`,
      });
      if (activityError) throw activityError;
    },
    onSuccess: () => {
      toast.success("Person removed — logged in timeline");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const addTask = useMutation({
    mutationFn: async (form: { title: string; due_date: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("tasks").insert({
        user_id: userData.user!.id,
        lead_id: id,
        campaign_id: activeCampaign || null,
        type: "general_reminder",
        title: form.title.trim(),
        due_date: form.due_date,
      });
      if (error) throw error;
      // Auto-add to the user's Google Calendar if connected (silent otherwise).
      const added = await autoCreateGoogleEvent({
        title: `${form.title.trim()} — ${lead.business_name}`,
        description: `ORMS task for ${lead.business_name}`,
        start: new Date(`${form.due_date}T09:00:00`),
      }, access.workspace.id);
      return added;
    },
    onSuccess: (added) => {
      toast.success(added ? "Task added — synced to Google Calendar" : "Task added");
      setTaskForm(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const completeTask = useMutation({
    mutationFn: async (taskId: string) => {
      const query = supabase
        .from("tasks")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", taskId).eq("lead_id", id);
      const { error } = await scopeCampaign(query, campaignId).select("id").single();
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task completed");
      invalidateAll();
    },
  });

  const dueClass = (dueDate: string) => toneClass(dueTone(dueDate, todayStr()));

  if (leadError) return <p role="alert" className="text-sm text-destructive">Could not load this lead: {leadError.message}</p>;
  if (!lead) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if ((!campaignId && !access.isOwner) || !validScope) return (
    <Card><CardContent className="space-y-3 pt-6">
      <h1 className="font-semibold">This lead is not in that campaign</h1>
      <p className="text-sm text-muted-foreground">Open its lead-library record or add it to the campaign first.</p>
      <Button asChild><Link href={access.isOwner ? leadHref(id) : "/campaigns"}>{access.isOwner ? "Open lead library" : "Open assigned campaigns"}</Link></Button>
    </CardContent></Card>
  );

  const statusTargetId = activeCampaign;
  const statusTarget = activeMembership;

  const pendingTasks = tasks?.filter((t) => t.status === "pending") ?? [];
  const hasOutreach = (activities ?? []).some((a) => OUTREACH_TYPES.includes(a.type));
  const noNextStep = hasOutreach && pendingTasks.length === 0;
  const navigationBlocked = !!(logNote.trim() || noteContent.trim() || editForm || personForm || taskForm || meetingAt)
    || doQuickLog.isPending || applyStatus.isPending || addNote.isPending || saveEdit.isPending
    || savePerson.isPending || deletePerson.isPending || addTask.isPending || completeTask.isPending;

  return (
    <div className="space-y-6">
      {fromCampaign && (
        <Link
          href={`/campaigns/${fromCampaign}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to campaign
        </Link>
      )}
      {campaignId && <CampaignLeadNavigator campaignId={campaignId} leadId={id} blocked={navigationBlocked} />}
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

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="size-5" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">{activeMembership ? "Campaign workspace" : "Lead library"}</p>
              <h2 className="mt-1 font-semibold">{activeMembership?.campaigns.name ?? "Shared contact record"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{activeMembership ? "Outreach, notes, tasks, and progress belong to this campaign." : "Choose a campaign to start outreach. Contact details stay shared across your workspace."}</p>
            </div>
          </div>
          <Select value={activeCampaign || "library"} onValueChange={(value) => router.push(leadHref(id, value === "library" ? null : value))}>
            <SelectTrigger aria-label="Workspace context" className="w-full bg-card sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {access.isOwner && <SelectItem value="library">Lead library</SelectItem>}
              {campaignLeads.map((cl) => <SelectItem key={cl.id} value={cl.campaigns.id}>{cl.campaigns.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {activeMembership && <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-primary/10 pt-4 text-sm">
          <Badge className={statusClass(activeMembership.status)}>{STATUS_LABELS[activeMembership.status]}</Badge>
          <span><strong>{activeMembership.touch_count}</strong> touches in this campaign</span>
          <span className="text-muted-foreground">{pendingTasks.length} pending tasks</span>
        </div>}
      </div>
      {(activitiesError || tasksError) && <p role="alert" className="text-sm text-destructive">Could not load campaign history: {activitiesError?.message ?? tasksError?.message}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: info */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Contact details <span className="ml-1 text-xs font-normal text-muted-foreground">Shared</span></CardTitle>
                {!editForm && access.isOwner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() =>
                      setEditForm({
                        business_name: lead.business_name ?? "",
                        website: lead.website ?? "",
                        address: lead.address ?? "",
                        city: lead.city ?? "",
                        country: lead.country ?? "",
                        emails: (lead.lead_emails ?? []).map((e: { id: string; email: string }) => ({
                          id: e.id, email: e.email, original: e.email,
                        })),
                        phones: (lead.lead_phones ?? []).map((p: { id: string; phone: string }) => ({
                          id: p.id, phone: p.phone, original: p.phone,
                        })),
                        custom: Object.entries(
                          (lead.custom_fields ?? {}) as Record<string, string>
                        ).map(([key, value]) => ({ key, value, originalKey: key })),
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span className="ml-1 text-xs">Edit</span>
                  </Button>
                )}
              </div>
            </CardHeader>
            {editForm ? (
              <CardContent className="space-y-3 text-sm">
                {([
                  ["business_name", "Name"],
                  ["website", "Website"],
                  ["address", "Address"],
                  ["city", "City"],
                  ["country", "Country"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <Input
                      className="h-8"
                      value={editForm[key]}
                      onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Emails</p>
                  {editForm.emails.map((e, i) => (
                    <div key={e.id ?? `new-${i}`} className="flex gap-1">
                      <Input
                        className="h-8"
                        value={e.email}
                        onChange={(ev) => {
                          const emails = [...editForm.emails];
                          emails[i] = { ...emails[i], email: ev.target.value };
                          setEditForm({ ...editForm, emails });
                        }}
                      />
                      <Button
                        size="sm" variant="ghost" className="h-8 px-2"
                        onClick={() => {
                          const emails = [...editForm.emails];
                          if (emails[i].id) emails[i] = { ...emails[i], email: "" };
                          else emails.splice(i, 1);
                          setEditForm({ ...editForm, emails });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm" variant="outline" className="h-7"
                    onClick={() =>
                      setEditForm({ ...editForm, emails: [...editForm.emails, { email: "" }] })
                    }
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add email
                  </Button>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Phones</p>
                  {editForm.phones.map((p, i) => (
                    <div key={p.id ?? `new-${i}`} className="flex gap-1">
                      <Input
                        className="h-8"
                        value={p.phone}
                        onChange={(ev) => {
                          const phones = [...editForm.phones];
                          phones[i] = { ...phones[i], phone: ev.target.value };
                          setEditForm({ ...editForm, phones });
                        }}
                      />
                      <Button
                        size="sm" variant="ghost" className="h-8 px-2"
                        onClick={() => {
                          const phones = [...editForm.phones];
                          if (phones[i].id) phones[i] = { ...phones[i], phone: "" };
                          else phones.splice(i, 1);
                          setEditForm({ ...editForm, phones });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm" variant="outline" className="h-7"
                    onClick={() =>
                      setEditForm({ ...editForm, phones: [...editForm.phones, { phone: "" }] })
                    }
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add phone
                  </Button>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Custom fields</p>
                  {editForm.custom.map((f, i) => (
                    <div key={f.originalKey ?? `new-${i}`} className="flex gap-1">
                      <Input
                        className="h-8 w-1/3"
                        placeholder="Field"
                        value={f.key}
                        onChange={(ev) => {
                          const custom = [...editForm.custom];
                          custom[i] = { ...custom[i], key: ev.target.value };
                          setEditForm({ ...editForm, custom });
                        }}
                      />
                      <Input
                        className="h-8 flex-1"
                        placeholder="Value"
                        value={f.value}
                        onChange={(ev) => {
                          const custom = [...editForm.custom];
                          custom[i] = { ...custom[i], value: ev.target.value };
                          setEditForm({ ...editForm, custom });
                        }}
                      />
                      <Button
                        size="sm" variant="ghost" className="h-8 px-2"
                        onClick={() => {
                          const custom = [...editForm.custom];
                          custom.splice(i, 1);
                          setEditForm({ ...editForm, custom });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm" variant="outline" className="h-7"
                    onClick={() =>
                      setEditForm({
                        ...editForm,
                        custom: [...editForm.custom, { key: "", value: "" }],
                      })
                    }
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add field
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  All changes are logged in the relationship timeline.
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setEditForm(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={saveEdit.isPending || !editForm.business_name.trim()}
                    onClick={() => saveEdit.mutate(editForm)}
                  >
                    {saveEdit.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </CardContent>
            ) : (
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
              {people.length > 0 && (
                <div className="pt-2">
                  <p className="font-medium">People</p>
                  {people.map((d) => (
                    <p key={d.id} className="text-muted-foreground">
                      {personLabel(d)}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">People</CardTitle>
                {!personForm && access.isOwner && (
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2"
                    onClick={() => setPersonForm({ role: "Owner" })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="ml-1 text-xs">Add person</span>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!people.length && !personForm && (
                <p className="text-muted-foreground">
                  No people yet — add the owner, manager, receptionist, or anyone else you deal with.
                </p>
              )}

              {people.map((p) => (
                <div key={p.id} className="space-y-0.5 rounded-md border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{p.name}</p>
                      {p.role && <p className="text-xs text-muted-foreground">{p.role}</p>}
                    </div>
                    <div className="flex shrink-0">
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2"
                        disabled={!access.isOwner}
                        onClick={() => setPersonForm(p)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2"
                        disabled={deletePerson.isPending || !access.isOwner}
                        onClick={() => deletePerson.mutate(p)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {p.personal_phone && (
                    <p className="text-xs text-muted-foreground">📱 {p.personal_phone}</p>
                  )}
                  {p.phone && <p className="text-xs text-muted-foreground">☎ {p.phone}</p>}
                  {p.personal_email && (
                    <p className="truncate text-xs text-muted-foreground">✉ {p.personal_email}</p>
                  )}
                  {p.email && <p className="truncate text-xs text-muted-foreground">✉ {p.email}</p>}
                  {p.linkedin_url && (
                    <a
                      href={p.linkedin_url.startsWith("http") ? p.linkedin_url : `https://${p.linkedin_url}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      LinkedIn <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                </div>
              ))}

              {personForm && (
                <div className="space-y-2 rounded-md border p-2">
                  <Input
                    className="h-8" placeholder="Name"
                    value={personForm.name ?? ""}
                    onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })}
                  />
                  <div className="space-y-1">
                    <Select
                      value={ROLE_OPTIONS.includes(personForm.role ?? "") ? personForm.role! : "Other"}
                      onValueChange={(v) => setPersonForm({ ...personForm, role: v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Role / position" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!ROLE_OPTIONS.includes(personForm.role ?? "") && (
                      <Input
                        className="h-8" placeholder="Custom role / position"
                        value={personForm.role === "Other" ? "" : personForm.role ?? ""}
                        onChange={(e) => setPersonForm({ ...personForm, role: e.target.value })}
                      />
                    )}
                  </div>
                  <Input
                    className="h-8" placeholder="Personal number"
                    value={personForm.personal_phone ?? ""}
                    onChange={(e) => setPersonForm({ ...personForm, personal_phone: e.target.value })}
                  />
                  <Input
                    className="h-8" placeholder="Personal email"
                    value={personForm.personal_email ?? ""}
                    onChange={(e) => setPersonForm({ ...personForm, personal_email: e.target.value })}
                  />
                  <Input
                    className="h-8" placeholder="LinkedIn URL"
                    value={personForm.linkedin_url ?? ""}
                    onChange={(e) => setPersonForm({ ...personForm, linkedin_url: e.target.value })}
                  />
                  <Input
                    className="h-8" placeholder="Notes (optional)"
                    value={personForm.notes ?? ""}
                    onChange={(e) => setPersonForm({ ...personForm, notes: e.target.value })}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPersonForm(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={savePerson.isPending || !(personForm.name ?? "").trim()}
                      onClick={() => savePerson.mutate(personForm)}
                    >
                      {savePerson.isPending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {!!channelTouches?.length && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Touches by channel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {CHANNEL_ORDER.filter((ch) => channelTouches.some((t) => t.channel === ch)).map(
                  (ch) => {
                    const rows = channelTouches.filter((t) => t.channel === ch);
                    const total = rows.reduce((s, r) => s + r.touches, 0);
                    const last = rows
                      .map((r) => r.last_touch_at)
                      .sort()
                      .at(-1)!;
                    return (
                      <div key={ch} className="flex items-baseline justify-between gap-2">
                        <span>{CHANNEL_LABELS[ch]}</span>
                        <span className="text-xs text-muted-foreground">
                          {total}× · last {new Date(last).toLocaleDateString()}
                        </span>
                      </div>
                    );
                  }
                )}
              </CardContent>
            </Card>
          )}

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
                    <Badge className={statusClass(cl.status)}>{STATUS_LABELS[cl.status]}</Badge>
                    <span className="text-xs text-muted-foreground">{cl.touch_count} touches</span>
                    <Link href={leadHref(id, cl.campaigns.id)} aria-label={`Open ${cl.campaigns.name} workspace`} className="ml-auto text-primary"><ArrowUpRight className="size-4" /></Link>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Tasks</CardTitle>
                {!taskForm && writable && (
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2"
                    onClick={() =>
                      setTaskForm({ title: "", due_date: todayStr() })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="ml-1 text-xs">Add task</span>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {taskForm && (
                <div className="space-y-2 rounded-md border p-2">
                  <Input
                    className="h-8"
                    placeholder="What to do…"
                    value={taskForm.title}
                    onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  />
                  <Input
                    type="date"
                    className="h-8"
                    value={taskForm.due_date}
                    onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setTaskForm(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={addTask.isPending || !taskForm.title.trim() || !taskForm.due_date}
                      onClick={() => addTask.mutate(taskForm)}
                    >
                      {addTask.isPending ? "Adding…" : "Add"}
                    </Button>
                  </div>
                </div>
              )}
              {!pendingTasks.length && !taskForm && (
                <p className="text-muted-foreground">No pending tasks.</p>
              )}
              {pendingTasks.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{t.title}</p>
                      <Badge className={dueClass(t.due_date)}>
                        {t.due_date < todayStr()
                          ? "overdue"
                          : t.due_date === todayStr()
                            ? "today"
                            : "upcoming"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Due {t.due_date}</p>
                    <TaskAssignment id={t.id} campaignId={campaignId} assignedTo={t.assigned_to} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <AddToCalendar
                      variant="ghost"
                      label=""
                      event={{
                        title: `${t.title} — ${lead.business_name}`,
                        description: `ORMS task for ${lead.business_name}`,
                        start: new Date(`${t.due_date}T09:00:00`),
                        allDay: false,
                      }}
                      fileName={`task-${t.id}.ics`}
                    />
                    <Button size="sm" variant="outline" disabled={!canChangeTask(access.role(campaignId), access.userId, t.assigned_to)} onClick={() => completeTask.mutate(t.id)}>
                      Done
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right: quick-log + timeline */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Log a touch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!activeCampaign && <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{campaignLeads.length ? "Select a campaign above to log outreach in its workspace." : <>Add this lead to a <Link href="/campaigns" className="font-medium text-primary underline">campaign</Link> to start outreach.</>}</p>}
              <div className="flex flex-wrap gap-2">
                {fixedChannel ? <div className="flex min-h-11 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm"><LockKeyhole className="size-4 text-primary" /><span className="font-medium">{CHANNEL_LABELS[fixedChannel]}</span><Link href={`/campaigns/${campaignId}`} className="text-xs text-primary hover:underline">Campaign setting</Link></div> : <Select value={logChannel || "unspecified"} onValueChange={(value) => setLogChannel(value === "unspecified" ? "" : value)}>
                  <SelectTrigger aria-label="Channel used" className="min-h-11 w-48">
                    <SelectValue placeholder="Channel used…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">Channel used…</SelectItem>
                    {CHANNEL_ORDER.map((ch) => (
                      <SelectItem key={ch} value={ch}>{CHANNEL_LABELS[ch]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>}
                {people.length > 0 && (
                  <Select value={effectivePerson || "none"} onValueChange={(value) => setLogPerson(value === "none" ? "" : value)}>
                    <SelectTrigger aria-label="Person contacted" className="min-h-11 w-56 max-w-full">
                      <SelectValue placeholder="Person contacted (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No specific person</SelectItem>
                      {people.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{personLabel(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {fixedChannel && <p className="text-xs text-muted-foreground">This channel is fixed for every lead in this campaign.{access.isOwner ? " Change it from the campaign page." : " Your workspace owner manages this setting."}</p>}
              {effectivePerson && logPerson === null && <p className="text-xs text-muted-foreground">Linked contact preselected. You can choose another person above.</p>}
              <Input
                placeholder="Optional note for the event…"
                disabled={!writable}
                value={logNote}
                onChange={(e) => setLogNote(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {(Object.keys(QUICK_LOG_LABELS) as QuickLogAction[]).filter((action) => channelSupportsAction(effectiveChannel, action)).map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    variant="outline"
                    disabled={doQuickLog.isPending || !activeMembership || !writable}
                    onClick={() => {
                      // Meeting Booked asks for a time first (then logs + syncs to calendar).
                      if (a === "MEETING_BOOKED") {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        d.setHours(10, 0, 0, 0);
                        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                        setMeetingAt(d.toISOString().slice(0, 16));
                      } else {
                        doQuickLog.mutate({ action: a });
                      }
                    }}
                  >
                    {QUICK_LOG_LABELS[a]}
                  </Button>
                ))}
              </div>
              {meetingAt !== null && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-3">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Meeting date &amp; time</p>
                    <Input
                      type="datetime-local"
                      className="h-9 w-56"
                      value={meetingAt}
                      onChange={(e) => setMeetingAt(e.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={doQuickLog.isPending || !meetingAt || !activeMembership || !writable}
                    onClick={() =>
                      doQuickLog.mutate({ action: "MEETING_BOOKED", meetingAt: meetingAt! })
                    }
                  >
                    Log meeting
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMeetingAt(null)}>
                    Cancel
                  </Button>
                  <p className="w-full text-xs text-muted-foreground">
                    If Google Calendar is connected (Settings), this meeting is added to it
                    automatically.
                  </p>
                </div>
              )}
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
                        disabled={applyStatus.isPending || !statusTargetId || statusTarget?.status === s || !writable}
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
                <Select value={noteType} onValueChange={setNoteType} disabled={!writable}>
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
                  disabled={!writable}
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                />
                <Button
                  onClick={() => addNote.mutate()}
                  disabled={!noteContent.trim() || addNote.isPending || !writable}
                >
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{activeCampaign ? "Campaign timeline" : "Library notes & updates"}</CardTitle>
            </CardHeader>
            <CardContent>
              {activitiesLoading ? <p className="text-sm text-muted-foreground">Loading history…</p> : !activities?.length ? (
                <p className="text-sm text-muted-foreground">No activity yet — log your first outreach above.</p>
              ) : (
                <div className="space-y-4">
                  {activities.slice(0, 200).map((a) => {
                    const Icon = ACTIVITY_ICONS[a.type] ?? Clock;
                    return (
                      <div key={a.id} className="flex gap-3">
                        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${activityClass(a.type)}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {ACTIVITY_LABELS[a.type] ?? a.type}
                            {a.channel && (
                              <Badge variant="secondary" className="ml-2 text-xs font-normal">
                                {CHANNEL_LABELS[a.channel as ContactChannel] ?? a.channel}
                              </Badge>
                            )}
                            {a.decision_makers?.name && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                with {a.decision_makers.name}
                                {a.decision_makers.role ? ` (${a.decision_makers.role})` : ""}
                              </span>
                            )}
                            {a.campaigns?.name && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {a.campaigns.name}
                              </span>
                            )}
                          </p>
                          {a.content && (
                            <p className="whitespace-pre-line text-sm text-muted-foreground">{a.content}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {new Date(a.occurred_at).toLocaleString()}
                            {a.actor_name && <span> · {a.actor_name}</span>}
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
