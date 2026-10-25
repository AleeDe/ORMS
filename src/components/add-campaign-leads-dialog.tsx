"use client";

import { useWorkspaceClient } from "@/components/workspace-provider";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { addLeadsToCampaign } from "@/lib/campaign-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Candidate = { id: string; business_name: string; city: string | null; campaign_leads: { campaign_id: string }[] };
const PAGE_SIZE = 50;

export function AddCampaignLeadsDialog({ campaignId }: { campaignId: string }) {
  const supabase = useWorkspaceClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dataset, setDataset] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: datasets } = useQuery({ queryKey: ["datasets-simple"], enabled: open, queryFn: async () => {
    const { data, error } = await supabase.from("datasets").select("id, name").order("name");
    if (error) throw error;
    return data;
  } });
  const { data, isPending, error } = useQuery({
    queryKey: ["campaign-candidates", campaignId, dataset, search, page], enabled: open,
    queryFn: async () => {
      let query = supabase.from("leads").select("id, business_name, city, campaign_leads!campaign_leads_lead_id_fkey(campaign_id)", { count: "exact" });
      if (dataset !== "all") query = query.eq("dataset_id", dataset);
      if (search.trim()) query = query.ilike("business_name", `%${search.trim()}%`);
      const { data, count, error } = await query.order("business_name").order("id").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data as unknown as Candidate[], count: count ?? 0 };
    },
  });
  const add = useMutation({ mutationFn: () => addLeadsToCampaign(supabase, campaignId, [...selected]), onSuccess: (count) => {
    toast.success(`${count} lead${count === 1 ? "" : "s"} added with fresh campaign progress`);
    setSelected(new Set()); setOpen(false);
    for (const key of ["campaign-leads", "campaign-stats", "campaigns", "campaign-candidates", "campaign-lead-order", "leads", "lead", "analytics-campaigns"]) queryClient.invalidateQueries({ queryKey: [key] });
  }, onError: (e) => toast.error(e.message) });
  const available = data?.rows.filter((row) => !row.campaign_leads.some((cl) => cl.campaign_id === campaignId)) ?? [];
  const allSelected = available.length > 0 && available.every((row) => selected.has(row.id));
  return <Dialog open={open} onOpenChange={(value) => { if (!add.isPending) { setOpen(value); if (!value) setSelected(new Set()); } }}>
    <DialogTrigger asChild><Button><Plus className="mr-2 size-4" /> Add leads</Button></DialogTrigger>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader><DialogTitle>Bring your audience into this campaign</DialogTitle><DialogDescription>Pick from your lead library. New members start at zero touches; progress in other campaigns stays separate.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search leads" className="pl-9" placeholder="Search lead names…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
        <Select value={dataset} onValueChange={(value) => { setDataset(value); setPage(0); }}><SelectTrigger aria-label="Filter by dataset" className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All datasets</SelectItem>{datasets?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select>
      </div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={allSelected} disabled={!available.length || add.isPending} onCheckedChange={(value) => setSelected((prev) => { const next = new Set(prev); available.forEach((row) => value ? next.add(row.id) : next.delete(row.id)); return next; })} /> Select available leads on this page</label>
      <div className="max-h-80 min-h-32 overflow-y-auto rounded-xl border divide-y">
        {error ? <p role="alert" className="p-4 text-sm text-destructive">{error.message}</p> : isPending ? <p className="p-4 text-sm text-muted-foreground">Loading leads…</p> : !data?.rows.length ? <p className="p-4 text-sm text-muted-foreground">No matching leads. Try another filter or import a dataset first.</p> : data.rows.map((row) => {
          const alreadyAdded = row.campaign_leads.some((cl) => cl.campaign_id === campaignId);
          return <label key={row.id} className={`flex items-center gap-3 p-3 ${alreadyAdded ? "opacity-60" : "cursor-pointer hover:bg-muted/50"}`}><Checkbox aria-label={`Select ${row.business_name}`} disabled={alreadyAdded || add.isPending} checked={alreadyAdded || selected.has(row.id)} onCheckedChange={(value) => setSelected((prev) => { const next = new Set(prev); if (value) next.add(row.id); else next.delete(row.id); return next; })} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{row.business_name}</span><span className="text-xs text-muted-foreground">{row.city || "Lead library"}</span></span>{alreadyAdded && <Badge variant="secondary">Already added</Badge>}</label>;
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{data?.count ?? 0} matching leads · {selected.size} selected</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={!page || add.isPending} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={!data || (page + 1) * PAGE_SIZE >= data.count || add.isPending} onClick={() => setPage(page + 1)}>Next</Button></div></div>
      <DialogFooter><Button variant="outline" disabled={add.isPending} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!selected.size || add.isPending} onClick={() => add.mutate()}>{add.isPending ? "Adding leads…" : `Add ${selected.size || ""} leads`}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
