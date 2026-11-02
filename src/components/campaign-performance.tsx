"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfDay, subDays } from "date-fns";
import { Download, LoaderCircle } from "lucide-react";
import { useWorkspaceClient } from "@/components/workspace-provider";
import { memberPerformanceTotals, metricNumber, performanceCsv, WORK_ROLE_LABELS, type CampaignPerformance } from "@/lib/campaign-workflow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const metrics = [["touches", "Touches"], ["replies", "Replies"], ["qualified", "Qualified"], ["appointments", "Appointments"], ["won", "Wins"], ["lost", "Losses"], ["disqualified", "Not a fit"], ["completed_tasks", "Tasks done"], ["pending_tasks", "Pending"], ["overdue_tasks", "Overdue"]] as const;
export function CampaignPerformanceReport({ campaignId, range: externalRange }: { campaignId?: string | null; range?: string }) {
  const supabase = useWorkspaceClient();
  const [selection, setSelection] = useState("30"), [member, setMember] = useState("all");
  const range = externalRange ?? selection;
  const today = format(new Date(), "yyyy-MM-dd");
  const period = useMemo(() => {
    const anchor = new Date(`${today}T00:00:00`);
    return { from: range === "all" ? null : startOfDay(subDays(anchor, Number(range) - 1)).toISOString(),
      to: addDays(anchor, 1).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }, [range, today]);
  const query = useQuery({ queryKey: ["campaign-performance", campaignId ?? "all", period], refetchInterval: 60_000, queryFn: async () => {
    const { data, error } = await supabase.rpc("orms_campaign_performance", { p_campaign: campaignId ?? null, p_from: period.from, p_to: period.to, p_timezone: period.timezone });
    if (error) throw error; return data as CampaignPerformance;
  } });
  const rows = query.data?.members.filter(row => member === "all" || row.actor_key === member) ?? [];
  const choices = [...new Map(query.data?.members.map(row => [row.actor_key, row.label]) ?? []).entries()];
  function download() {
    if (!query.data) return;
    const blob = new Blob(["\uFEFF", performanceCsv({ ...query.data, members: rows })], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `orms-campaign-performance-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="space-y-4" aria-label="Campaign team performance">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Campaign performance</h2><p className="mt-1 text-xs text-muted-foreground">Member contributions and collective results for each campaign.</p></div><div className="flex flex-wrap gap-2">
      {!externalRange && <Select value={selection} onValueChange={setSelection}><SelectTrigger aria-label="Performance period" className="min-h-11 w-40"><SelectValue /></SelectTrigger><SelectContent>{["7", "30", "90", "all"].map(value => <SelectItem key={value} value={value}>{value === "all" ? "All time" : `Last ${value} days`}</SelectItem>)}</SelectContent></Select>}
      <Button variant="outline" disabled={!query.data || !rows.length} onClick={download}><Download className="size-4" />Export CSV</Button>
    </div></div>
    {query.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 motion-safe:animate-spin" />Loading performance…</p> : query.error ? <div role="alert" className="rounded-xl border border-destructive/20 p-4"><p className="text-sm text-destructive">Could not load performance: {query.error.message}</p><Button className="mt-2" variant="outline" onClick={() => query.refetch()}>Retry</Button></div> : <>
      <h3 className="text-sm font-semibold">Collective campaign totals</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Qualified leads", query.data?.totals.qualified], ["Appointments set", query.data?.totals.appointments], ["Wins", query.data?.totals.won], ["Tasks completed", query.data?.totals.completed_tasks]].map(([label, value]) => <Card key={label}><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">{label}</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{metricNumber(value).toLocaleString()}</p></CardContent></Card>)}</div>
      <p className="rounded-xl bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">Milestones count the first qualification, appointment and outcome for a lead in each campaign. Rescheduling and retries do not add another booked lead. Pending/overdue tasks and the qualified queue show the current workload; the other metrics use the selected period.</p>
      {!campaignId && <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Qualified queue</TableHead><TableHead className="text-right">Needs closer</TableHead>{metrics.slice(0, 6).map(([key, label]) => <TableHead key={key} className="text-right">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{query.data?.campaigns.map(row => <TableRow key={row.id}><TableCell className="font-medium">{row.name}</TableCell><TableCell className="text-right">{row.leads}</TableCell><TableCell className="text-right">{row.qualified_queue}</TableCell><TableCell className="text-right">{row.unassigned_qualified}</TableCell>{metrics.slice(0, 6).map(([key]) => <TableCell key={key} className="text-right tabular-nums">{metricNumber(row[key])}</TableCell>)}</TableRow>)}</TableBody></Table></div>}
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Member contributions</h3><Select value={member} onValueChange={setMember}><SelectTrigger aria-label="Performance member" className="min-h-11 w-full sm:w-64"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All members</SelectItem>{choices.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></div>
      {!campaignId && <div className="space-y-2"><h4 className="text-xs font-medium text-muted-foreground">Member totals across campaigns</h4><div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Member</TableHead><TableHead className="text-right">Campaigns</TableHead>{metrics.map(([key, label]) => <TableHead key={key} className="text-right">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{memberPerformanceTotals(rows).map(row => <TableRow key={row.actor_key}><TableCell className="max-w-64 break-words whitespace-normal font-medium">{row.label}</TableCell><TableCell className="text-right">{row.campaigns}</TableCell>{metrics.map(([key]) => <TableCell key={key} className="text-right tabular-nums">{row[key]}</TableCell>)}</TableRow>)}</TableBody></Table></div><p className="text-xs text-muted-foreground">The breakdown below shows where each contribution happened.</p></div>}
      <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow>{!campaignId && <TableHead>Campaign</TableHead>}<TableHead>Member</TableHead><TableHead>Work role</TableHead>{metrics.map(([key, label]) => <TableHead key={key} className="text-right">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length ? rows.map(row => <TableRow key={`${row.campaign_id}:${row.actor_key}`}>{!campaignId && <TableCell>{row.campaign_name}</TableCell>}<TableCell className="max-w-64 break-words whitespace-normal font-medium">{row.label}</TableCell><TableCell className="text-xs">{row.work_role === "historical" ? "Historical / unassigned" : WORK_ROLE_LABELS[row.work_role]}</TableCell>{metrics.map(([key]) => <TableCell key={key} className={`text-right tabular-nums ${key === "overdue_tasks" && row[key] ? "text-destructive" : ""}`}>{metricNumber(row[key])}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={campaignId ? 12 : 13} className="py-8 text-center text-muted-foreground">No member performance for these filters.</TableCell></TableRow>}</TableBody></Table></div>
      <p className="text-xs leading-5 text-muted-foreground">Credit stays with the member who performed the action, even after a role or access change. Historical lead statuses without an actor appear in pipeline totals without invented individual credit. Times use {period.timezone}.</p>
    </>}
  </section>;
}
