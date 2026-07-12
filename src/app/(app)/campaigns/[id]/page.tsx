"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/quick-log";
import { Button } from "@/components/ui/button";
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
    queryKey: ["campaign-leads", id, statusFilter, page],
    queryFn: async () => {
      let q = supabase
        .from("campaign_leads")
        .select(
          "id, status, touch_count, last_contacted_at, leads(id, business_name, website, custom_fields)",
          { count: "exact" }
        )
        .eq("campaign_id", id);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, count, error } = await q
        .order("added_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data as unknown as CampaignLead[], count: count ?? 0 };
    },
  });
  const rows = leadsPage?.rows;

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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{campaign?.name ?? "…"}</h1>
        {campaign?.description && (
          <p className="text-sm text-muted-foreground">{campaign.description}</p>
        )}
      </div>

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
              {dynamicColumns.map((k) => (
                <TableHead key={k} className="max-w-40 truncate" title={k}>{k}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4 + dynamicColumns.length} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : !filtered.length ? (
              <TableRow>
                <TableCell colSpan={4 + dynamicColumns.length} className="py-8 text-center text-muted-foreground">
                  No leads. Add leads from the Leads table (select → Add to Campaign).
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <Link href={`/leads/${r.leads.id}`} className="hover:underline">
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
                      <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
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
