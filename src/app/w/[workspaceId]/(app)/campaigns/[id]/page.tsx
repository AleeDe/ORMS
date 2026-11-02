"use client";

import { use, useMemo, useState } from "react";
import Link from "@/components/workspace-link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace, useWorkspaceClient } from "@/components/workspace-provider";
import { canManage, canWork } from "@/lib/workspace";
import { useCampaignTeam } from "@/hooks/use-campaign-team";
import { CampaignTeamRoles } from "@/components/campaign-team-roles";
import { CampaignPerformanceReport } from "@/components/campaign-performance";
import { WORKFLOW_FIELDS, workflowStatusAllowed, type WorkflowLead } from "@/lib/campaign-workflow";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/quick-log";
import { statusClass } from "@/lib/badge-styles";
import { leadHref } from "@/lib/campaign-scope";
import { AddCampaignLeadsDialog } from "@/components/add-campaign-leads-dialog";
import { CampaignChannelSettings } from "@/components/campaign-channel-settings";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { ROLE_OPTIONS, type ContactChannel } from "@/lib/people";
import {
  EMPTY_LEAD_FILTERS, hasActiveLeadFilters, resolveLeadFilterIds, type LeadFilters,
} from "@/lib/lead-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

const PAGE_SIZE = 50;

type CampaignLead = {
  id: string;
  status: string;
  touch_count: number;
  last_contacted_at: string | null;
  workflow_stage?: WorkflowLead["workflow_stage"];
  assigned_closer_id?: string | null;
  qualified_by?: string | null;
  appointment_at?: string | null;
  leads: {
    id: string;
    business_name: string;
    website: string | null;
    custom_fields: Record<string, string>;
  };
};

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { isOwner, role, userId } = useWorkspace();
  const writable = canWork(role(id));
  const supabase = useWorkspaceClient();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [view, setView] = useState("all");
  const team = useCampaignTeam(id);
  const workflowReady = team.data?.available === true;
  const workRole = team.data?.members.find(member => member.user_id === userId)?.work_role;
  const canReport = canManage(role(id));
  const workerLabel = (user: string | null | undefined) => team.data?.members.find(member => member.user_id === user)?.label ?? (user ? "Former member" : "Unassigned");
  const [leadFilters, setLeadFilters] = useState<LeadFilters>(EMPTY_LEAD_FILTERS);

  const patchLeadFilters = (patch: Partial<LeadFilters>) => {
    setLeadFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };
  const filtersActive = hasActiveLeadFilters(leadFilters);

  // The lead-side filters (search, email/website/phone/people/custom field) work
  // on `leads`, but this page paginates `campaign_leads`. Resolve them to ids and
  // constrain by those — see lib/lead-filters.ts for the anti-join rules.
  const { data: filteredLeadIds } = useQuery({
    queryKey: ["campaign-lead-filter-ids", id, leadFilters],
    enabled: filtersActive,
    queryFn: () => resolveLeadFilterIds(supabase, leadFilters),
  });

  const { data: campaign, error: campaignError } = useQuery({
    queryKey: ["campaign", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: leadsPage, isLoading, error: leadsError } = useQuery({
    queryKey: ["campaign-leads", id, statusFilter, page, leadFilters, filteredLeadIds, workflowReady, view],
    // Wait for the id resolution rather than flashing unfiltered rows first.
    enabled: !filtersActive || Array.isArray(filteredLeadIds),
    queryFn: async () => {
      let q = supabase
        .from("campaign_leads")
        .select(
          `id, status, touch_count, last_contacted_at, ${workflowReady ? `${WORKFLOW_FIELDS}, ` : ""}leads!campaign_leads_lead_id_fkey(id, business_name, website, custom_fields)`,
          { count: "exact" }
        )
        .eq("campaign_id", id);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (workflowReady && ["prospecting", "qualified", "won", "lost"].includes(view)) q = q.eq("workflow_stage", view);
      if (filtersActive) q = q.in("lead_id", filteredLeadIds ?? []);
      const { data, count, error } = await q
        .order("added_at", { ascending: false })
        .order("id")
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data as unknown as CampaignLead[], count: count ?? 0 };
    },
  });
  const rows = leadsPage?.rows;

  const { data: statCounts, error: statsError } = useQuery({
    queryKey: ["campaign-stats", id, workflowReady],
    queryFn: async () => {
      const base = () =>
        supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      const results = await Promise.all([
        base(),
        base().or("touch_count.gt.0,status.neq.new"),
        base().in("status", ["replied", "interested_meeting", "won"]),
        base().in("status", ["interested_meeting", "won"]),
        base().eq("status", "won"),
        ...(workflowReady ? [base().eq("workflow_stage", "prospecting"), base().eq("workflow_stage", "qualified"), base().eq("workflow_stage", "lost")] : []),
      ]);
      const failed = results.find(result => result.error); if (failed?.error) throw failed.error;
      const [total, contacted, replied, meetings, won, prospecting, qualified, lost] = results;
      return {
        total: total.count ?? 0,
        contacted: contacted.count ?? 0,
        replied: replied.count ?? 0,
        meetings: meetings.count ?? 0,
        won: won.count ?? 0,
        prospecting: prospecting?.count ?? 0, qualified: qualified?.count ?? 0, lost: lost?.count ?? 0,
      };
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ clId, leadId, to }: { clId: string; leadId: string; to: string }) => {
      const { error } = await supabase
        .from("campaign_leads").update({ status: to }).eq("id", clId)
        .eq("campaign_id", id).eq("lead_id", leadId).select("id").single();
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      const { error: activityError } = await supabase.from("activities").insert({
        user_id: userData.user!.id, lead_id: leadId, campaign_id: id,
        type: "STATUS_CHANGED", content: `Status → ${STATUS_LABELS[to]}`,
      });
      if (activityError) throw activityError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-leads", id] });
      queryClient.invalidateQueries({ queryKey: ["campaign-stats", id] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["lead"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-activities"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-workflow"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-performance"] });
      toast.success("Status updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statCounts ?? { total: 0, contacted: 0, replied: 0, meetings: 0, won: 0, prospecting: 0, qualified: 0, lost: 0 };
  const filtered = rows ?? [];
  const totalPages = Math.max(1, Math.ceil((leadsPage?.count ?? 0) / PAGE_SIZE));

  // dynamic columns from the campaign's leads' custom fields (max 4 to keep status/touches readable)
  const dynamicColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows ?? []) {
      Object.keys(r.leads?.custom_fields ?? {}).forEach((k) => keys.add(k));
    }
    return [...keys].sort().slice(0, 4);
  }, [rows]);

  return (
    <div className="space-y-6">
      <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" /> All campaigns</Link>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Campaign workspace</p>
          <h1 className="text-3xl font-bold tracking-tight">{campaign?.name ?? "…"}</h1>
          {campaign?.description && (
            <p className="text-sm text-muted-foreground">{campaign.description}</p>
          )}
        </div>
        {campaign && isOwner && <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/team">Team & access</Link></Button><AddCampaignLeadsDialog campaignId={id} /></div>}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div><p className="font-semibold">One campaign. Its own progress.</p><p className="mt-1 text-muted-foreground">Open a lead to log touches, notes, and follow-ups here. The same lead can follow a completely different journey in another campaign.</p></div>
      </div>
      {(campaignError || leadsError || statsError) && <p role="alert" className="text-sm text-destructive">{campaignError?.message ?? leadsError?.message ?? statsError?.message}</p>}
      {campaign && isOwner && <CampaignChannelSettings key={`${id}:${campaign.default_channel ?? "per_touch"}`} campaignId={id} initial={(campaign.default_channel as ContactChannel | null) ?? null} />}
      {campaign && !isOwner && <p className="text-sm text-muted-foreground">Your role: <strong className="capitalize">{role(id)}</strong>{!writable && ". This campaign is read-only."}</p>}
      {campaign && <CampaignTeamRoles campaignId={id} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          ["Total Leads", stats.total],
          ["Contacted", stats.contacted],
          ["Replied", stats.replied],
          [workflowReady ? "Qualified queue" : "Meetings", workflowReady ? stats.qualified : stats.meetings],
          ["Won", stats.won],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{value}</p></CardContent>
          </Card>
        ))}
      </div>

      {workflowReady && <div className="overflow-x-auto pb-1"><Tabs value={view} onValueChange={value => { setView(value); setPage(0); setStatusFilter("all"); }}><TabsList aria-label="Campaign lead pipeline" className="min-h-11"><TabsTrigger value="all">All leads ({stats.total})</TabsTrigger><TabsTrigger value="prospecting">Prospecting ({stats.prospecting})</TabsTrigger><TabsTrigger value="qualified">Qualified ({stats.qualified})</TabsTrigger><TabsTrigger value="won">Won ({stats.won})</TabsTrigger><TabsTrigger value="lost">Lost / not a fit ({stats.lost})</TabsTrigger>{canReport && <TabsTrigger value="performance">Performance</TabsTrigger>}</TabsList></Tabs></div>}
      {view === "performance" && workflowReady && canReport ? <CampaignPerformanceReport key={id} campaignId={id} /> : <>
      {/* Same filter vocabulary as /leads, so a campaign can be sliced the same
          way. The lead-side ones resolve through lib/lead-filters.ts. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name, number, email, any field…"
          className="w-72"
          value={leadFilters.search}
          onChange={(e) => patchLeadFilters({ search: e.target.value })}
        />
        <Select
          value={leadFilters.emailFilter}
          onValueChange={(v) => patchLeadFilters({ emailFilter: v })}
        >
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Email: any</SelectItem>
            <SelectItem value="valid">Email: valid syntax</SelectItem>
            <SelectItem value="invalid">Email: invalid syntax</SelectItem>
            <SelectItem value="has">Email: has one</SelectItem>
            <SelectItem value="none">Email: missing</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={leadFilters.websiteFilter}
          onValueChange={(v) => patchLeadFilters({ websiteFilter: v })}
        >
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Website: any</SelectItem>
            <SelectItem value="has">Website: has one</SelectItem>
            <SelectItem value="none">Website: missing</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={leadFilters.phoneFilter}
          onValueChange={(v) => patchLeadFilters({ phoneFilter: v })}
        >
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Phone: any</SelectItem>
            <SelectItem value="has">Phone: has one</SelectItem>
            <SelectItem value="none">Phone: missing</SelectItem>
            <SelectItem value="personal">Has personal number</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={leadFilters.personFilter}
          onValueChange={(v) => patchLeadFilters({ personFilter: v })}
        >
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">People: any</SelectItem>
            <SelectItem value="has">Has a person</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>Role: {r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={leadFilters.fieldKey}
          onValueChange={(v) => patchLeadFilters({ fieldKey: v })}
        >
          <SelectTrigger className="w-44"><SelectValue placeholder="Field…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Field: any</SelectItem>
            {dynamicColumns.map((k) => (
              <SelectItem key={k} value={k}>{k}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {leadFilters.fieldKey !== "any" && (
          <Input
            placeholder={`${leadFilters.fieldKey} contains…`}
            className="w-44"
            value={leadFilters.fieldValue}
            onChange={(e) => patchLeadFilters({ fieldValue: e.target.value })}
          />
        )}
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setLeadFilters(EMPTY_LEAD_FILTERS); setPage(0); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{leadsPage?.count ?? "…"} leads</span>
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Touches</TableHead>
              <TableHead>Last Contacted</TableHead>
              {workflowReady && <><TableHead>Qualified by</TableHead><TableHead>Closer</TableHead><TableHead>Appointment</TableHead></>}
              {dynamicColumns.map((k) => (
                <TableHead key={k} className="max-w-40 truncate" title={k}>{k}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4 + dynamicColumns.length + (workflowReady ? 3 : 0)} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : !filtered.length ? (
              <TableRow>
                <TableCell colSpan={4 + dynamicColumns.length + (workflowReady ? 3 : 0)} className="py-8 text-center text-muted-foreground">
                  No leads. Add leads from the Leads table (select → Add to Campaign).
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={leadHref(r.leads.id, id)}
                      className="text-primary hover:underline"
                    >
                      {r.leads.business_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={r.status}
                      onValueChange={(v) =>
                        updateStatus.mutate({ clId: r.id, leadId: r.leads.id, to: v })
                      }
                    >
                      <SelectTrigger disabled={!writable || (workflowReady && ["won", "lost"].includes(r.workflow_stage ?? "") && !canReport)} className={`h-7 w-44 border-0 text-xs font-medium ${statusClass(r.status)}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_ORDER.map((s) => (
                          <SelectItem key={s} value={s} disabled={workflowReady && !workflowStatusAllowed(s, role(id), workRole, { workflow_stage: r.workflow_stage ?? "prospecting", assigned_closer_id: r.assigned_closer_id ?? null }, userId)}>{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">{r.touch_count}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.last_contacted_at
                      ? new Date(r.last_contacted_at).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  {workflowReady && <><TableCell className="max-w-48 break-words whitespace-normal text-xs">{workerLabel(r.qualified_by)}</TableCell><TableCell className="max-w-48 break-words whitespace-normal text-xs">{workerLabel(r.assigned_closer_id)}</TableCell><TableCell className="whitespace-nowrap text-xs">{r.appointment_at ? new Date(r.appointment_at).toLocaleString() : "—"}</TableCell></>}
                  {dynamicColumns.map((k) => (
                    <TableCell
                      key={k}
                      className="max-w-40 truncate text-sm"
                      title={r.leads.custom_fields?.[k]}
                    >
                      {r.leads.custom_fields?.[k] ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {page + 1} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      </>}
    </div>
  );
}
