"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/quick-log";
import { statusClass, toneClass, enrollmentTone } from "@/lib/badge-styles";
import { ROLE_OPTIONS } from "@/lib/people";
import {
  EMPTY_LEAD_FILTERS, hasActiveLeadFilters, resolveLeadFilterIds, type LeadFilters,
} from "@/lib/lead-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EnrollCampaignDialog } from "@/components/enroll-campaign-dialog";
import { CampaignReview } from "@/components/campaign-review";
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
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
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

  const { data: campaign } = useQuery({
    queryKey: ["campaign", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: leadsPage, isLoading } = useQuery({
    queryKey: ["campaign-leads", id, statusFilter, page, leadFilters, filteredLeadIds],
    // Wait for the id resolution rather than flashing unfiltered rows first.
    enabled: !filtersActive || Array.isArray(filteredLeadIds),
    queryFn: async () => {
      let q = supabase
        .from("campaign_leads")
        .select(
          "id, status, touch_count, last_contacted_at, leads(id, business_name, website, custom_fields)",
          { count: "exact" }
        )
        .eq("campaign_id", id);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (filtersActive) q = q.in("lead_id", filteredLeadIds ?? []);
      const { data, count, error } = await q
        .order("added_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data as unknown as CampaignLead[], count: count ?? 0 };
    },
  });
  const rows = leadsPage?.rows;

  // Which sequence each visible lead is already on. Fetched for the current page
  // rather than embedded in the query above, because a lead can hold several
  // enrollments and an embed would multiply the campaign_leads rows.
  //
  // Without this you cannot tell from the campaign screen that leads are already
  // mid-sequence, which makes it easy to enrol the same people twice.
  const leadIds = (leadsPage?.rows ?? []).map((r) => r.leads.id);
  const { data: enrollmentsByLead } = useQuery({
    queryKey: ["campaign-lead-enrollments", id, leadIds],
    enabled: leadIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_enrollments")
        .select("id, lead_id, status, current_step, paused_reason, email_sequences(name)")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const rows = data as unknown as {
        id: string; lead_id: string; status: string; current_step: number;
        paused_reason: string | null;
        email_sequences: { name: string } | null;
      }[];

      // Live enrollments first, so a lead that finished one sequence and is now
      // running another shows the one that still matters.
      const rank = (s: string) => (s === "active" ? 0 : s === "paused" ? 1 : 2);
      const byLead = new Map<string, (typeof rows)[number]>();
      for (const r of [...rows].sort((a, b) => rank(a.status) - rank(b.status))) {
        if (!byLead.has(r.lead_id)) byLead.set(r.lead_id, r);
      }
      return byLead;
    },
  });

  const { data: statCounts } = useQuery({
    queryKey: ["campaign-stats", id],
    queryFn: async () => {
      const base = () =>
        supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      const [total, contacted, replied, meetings, won] = await Promise.all([
        base(),
        base().neq("status", "new"),
        base().in("status", ["replied", "interested_meeting", "won"]),
        base().in("status", ["interested_meeting", "won"]),
        base().eq("status", "won"),
      ]);
      return {
        total: total.count ?? 0,
        contacted: contacted.count ?? 0,
        replied: replied.count ?? 0,
        meetings: meetings.count ?? 0,
        won: won.count ?? 0,
      };
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ clId, leadId, to }: { clId: string; leadId: string; to: string }) => {
      const { error } = await supabase
        .from("campaign_leads").update({ status: to }).eq("id", clId);
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("activities").insert({
        user_id: userData.user!.id, lead_id: leadId, campaign_id: id,
        type: "STATUS_CHANGED", content: `Status → ${STATUS_LABELS[to]}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-leads", id] });
      queryClient.invalidateQueries({ queryKey: ["campaign-stats", id] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["lead"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-campaigns"] });
      toast.success("Status updated");
    },
    onError: (e) => toast.error(e.message),
  });

  // Pause a lead when a reply lands (and resume it later). Pausing keeps
  // current_step, so resuming continues the sequence instead of restarting it.
  const holdLead = useMutation({
    mutationFn: async (v: { enrollmentId: string; action: "pause" | "resume"; leadId: string }) => {
      const res = await fetch("/api/email/lead-hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentId: v.enrollmentId,
          leadId: v.leadId,
          action: v.action,
          reason: v.action === "pause" ? "replied" : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update the lead");
      return json;
    },
    onSuccess: (_d, v) => {
      toast.success(v.action === "pause" ? "Paused — reply received" : "Resumed");
      queryClient.invalidateQueries({ queryKey: ["campaign-lead-enrollments", id] });
      queryClient.invalidateQueries({ queryKey: ["campaign-send-summary", id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statCounts ?? { total: 0, contacted: 0, replied: 0, meetings: 0, won: 0 };
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{campaign?.name ?? "…"}</h1>
          {campaign?.description && (
            <p className="text-sm text-muted-foreground">{campaign.description}</p>
          )}
        </div>
        {campaign && (
          <EnrollCampaignDialog campaignId={campaign.id} campaignName={campaign.name} />
        )}
      </div>

      {/* Approve every step, then start — the scheduler sends from there. */}
      {campaign && (
        <CampaignReview
          campaignId={campaign.id}
          sendState={campaign.send_state ?? "draft"}
        />
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          ["Total Leads", stats.total],
          ["Contacted", stats.contacted],
          ["Replied", stats.replied],
          ["Meetings", stats.meetings],
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
              <TableHead>Sequence</TableHead>
              {dynamicColumns.map((k) => (
                <TableHead key={k} className="max-w-40 truncate" title={k}>{k}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5 + dynamicColumns.length} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : !filtered.length ? (
              <TableRow>
                <TableCell colSpan={5 + dynamicColumns.length} className="py-8 text-center text-muted-foreground">
                  No leads. Add leads from the Leads table (select → Add to Campaign).
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/leads/${r.leads.id}?from=campaign:${id}`}
                      className="hover:underline"
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
                      <SelectTrigger className={`h-7 w-44 border-0 text-xs font-medium ${statusClass(r.status)}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
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
                  <TableCell className="text-sm">
                    {(() => {
                      const en = enrollmentsByLead?.get(r.leads.id);
                      if (!en) return <span className="text-muted-foreground">—</span>;
                      return (
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Badge className={`${toneClass(enrollmentTone(en.status))} font-normal`}>
                            {en.status}
                          </Badge>
                          <span className="max-w-32 truncate" title={en.email_sequences?.name ?? ""}>
                            {en.email_sequences?.name ?? "Sequence"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            step {en.current_step}
                          </span>
                          {/* Reply handling lives on the row: find the lead,
                              pause it, resume when the conversation ends. */}
                          {en.status === "active" && (
                            <Button
                              size="sm" variant="ghost" className="h-6 px-1 text-xs"
                              onClick={() => holdLead.mutate({
                                enrollmentId: en.id, leadId: r.leads.id, action: "pause",
                              })}
                            >
                              Reply
                            </Button>
                          )}
                          {en.status === "paused" && (
                            <Button
                              size="sm" variant="ghost" className="h-6 px-1 text-xs"
                              onClick={() => holdLead.mutate({
                                enrollmentId: en.id, leadId: r.leads.id, action: "resume",
                              })}
                            >
                              Resume
                            </Button>
                          )}
                        </span>
                      );
                    })()}
                  </TableCell>
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
    </div>
  );
}
