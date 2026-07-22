"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ExternalLink, Columns3 } from "lucide-react";
import { ROLE_OPTIONS } from "@/lib/people";

const PAGE_SIZE = 50;
const COL_PREFS_KEY = "leads.hiddenColumns";

type LeadRow = {
  id: string;
  business_name: string;
  website: string | null;
  tags: string[];
  created_at: string;
  custom_fields: Record<string, string>;
  lead_emails: { email: string; is_primary: boolean }[];
  campaign_leads: { count: number }[];
};

function LeadsInner() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const datasetFilter = searchParams.get("dataset");

  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaignDialog, setCampaignDialog] = useState(false);
  const [tagDialog, setTagDialog] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [targetCampaign, setTargetCampaign] = useState("");
  const [fieldsDialog, setFieldsDialog] = useState(false);
  const [columnsDialog, setColumnsDialog] = useState(false);
  const [fieldRenames, setFieldRenames] = useState<Record<string, string>>({});
  // Per-dataset column choice; a missing entry = auto (show only fields with values)
  const [colPrefs, setColPrefs] = useState<Record<string, string[]>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem(COL_PREFS_KEY) ?? "{}") as Record<string, string[]>;
    } catch {
      return {};
    }
  });
  // advanced filters — persisted per dataset in localStorage so they survive
  // navigation/refresh and don't reset every time (esp. inside a campaign).
  const fKey = `leads.filters.${datasetFilter ?? "all"}`;
  const [selectingAll, setSelectingAll] = useState(false);

  type FilterState = {
    search: string; sort: string; emailFilter: string; websiteFilter: string;
    campaignFilter: string; phoneFilter: string; personFilter: string;
    touchFrom: string; touchTo: string; fieldKey: string; fieldValue: string;
  };
  const DEFAULT_FILTERS: FilterState = {
    search: "", sort: "created_at.desc", emailFilter: "any", websiteFilter: "any",
    campaignFilter: "any", phoneFilter: "any", personFilter: "any",
    touchFrom: "", touchTo: "", fieldKey: "any", fieldValue: "",
  };
  const loadFilters = (key: string): FilterState => {
    if (typeof window === "undefined") return DEFAULT_FILTERS;
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as FilterState) } : DEFAULT_FILTERS;
    } catch {
      return DEFAULT_FILTERS;
    }
  };

  const [ff, setFf] = useState<FilterState>(() => loadFilters(fKey));
  // React pattern: store the key we loaded for in state; when the dataset (hence
  // storage key) changes, reload that dataset's saved filters — no effect needed.
  const [ffKey, setFfKey] = useState(fKey);
  if (ffKey !== fKey) {
    setFfKey(fKey);
    setFf(loadFilters(fKey));
    setPage(0);
  }

  const { search, sort, emailFilter, websiteFilter, campaignFilter,
    phoneFilter, personFilter, touchFrom, touchTo, fieldKey, fieldValue } = ff;
  const patchFilter = (p: Partial<FilterState>) => { setFf((f) => ({ ...f, ...p })); setPage(0); };
  const setSearch = (v: string) => patchFilter({ search: v });
  const setSort = (v: string) => setFf((f) => ({ ...f, sort: v }));
  const setEmailFilter = (v: string) => patchFilter({ emailFilter: v });
  const setWebsiteFilter = (v: string) => patchFilter({ websiteFilter: v });
  const setCampaignFilter = (v: string) => patchFilter({ campaignFilter: v });
  const setPhoneFilter = (v: string) => patchFilter({ phoneFilter: v });
  const setPersonFilter = (v: string) => patchFilter({ personFilter: v });
  const setTouchFrom = (v: string) => patchFilter({ touchFrom: v });
  const setTouchTo = (v: string) => patchFilter({ touchTo: v });
  const setFieldKey = (v: string) => patchFilter({ fieldKey: v });
  const setFieldValue = (v: string) => patchFilter({ fieldValue: v });

  // Column choice is remembered per dataset (each sheet has its own field set).
  const prefKey = datasetFilter ?? "all";
  const hiddenColumns: string[] | null = colPrefs[prefKey] ?? null;

  function persistPrefs(next: Record<string, string[]>) {
    setColPrefs(next);
    localStorage.setItem(COL_PREFS_KEY, JSON.stringify(next));
  }

  function applyHiddenColumns(next: string[]) {
    persistPrefs({ ...colPrefs, [prefKey]: next });
  }

  function resetColumns() {
    const next = { ...colPrefs };
    delete next[prefKey];
    persistPrefs(next);
  }

  const filterState: FilterState = ff;

  // Persist filters for this dataset on every change.
  if (typeof window !== "undefined") {
    localStorage.setItem(fKey, JSON.stringify(ff));
  }

  function clearFilters() {
    setFf(DEFAULT_FILTERS);
    setPage(0);
  }

  const activeFilterCount = [
    emailFilter, websiteFilter, campaignFilter, phoneFilter, personFilter,
  ].filter((v) => v !== "any").length + (touchFrom || touchTo ? 1 : 0)
    + (fieldKey !== "any" && fieldValue.trim() ? 1 : 0);

  const filters = {
    datasetFilter, page, ...filterState,
  };

  // Full-field search (name/phone/email/website/custom) via the search_leads RPC:
  // resolve to matching ids, then AND with the other filters below.
  const { data: searchIds } = useQuery({
    queryKey: ["leads-search-ids", search, datasetFilter],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_leads", {
        p_query: search.trim(), p_limit: 500,
      });
      if (error) throw error;
      return (data as { id: string }[]).map((r) => r.id);
    },
  });

  // Builds the filtered query; `forIds` selects only ids (used by "select all matching")
  function buildQuery(forIds = false) {
    const embeds: string[] = ["lead_emails(email, is_primary)", "campaign_leads(count)"];
    if (emailFilter === "valid") embeds.push("emf:lead_emails!inner(id)");
    if (emailFilter === "invalid") embeds.push("emf:lead_emails!inner(id)");
    if (emailFilter === "has") embeds.push("emf:lead_emails!inner(id)");
    if (emailFilter === "none") embeds.push("emf:lead_emails()");
    if (campaignFilter !== "any" && campaignFilter !== "none")
      embeds.push("clf:campaign_leads!inner(campaign_id)");
    if (campaignFilter === "none") embeds.push("clf:campaign_leads()");

    if (phoneFilter === "has") embeds.push("phf:lead_phones!inner(id)");
    if (phoneFilter === "none") embeds.push("phf:lead_phones()");

    // Touch-date range + personal-number / person-role filters live on the
    // lead_filter_facts view; embed it when any of them is active.
    const needFacts =
      phoneFilter === "personal" || personFilter !== "any" || !!touchFrom || !!touchTo;
    if (needFacts) embeds.push("lff:lead_filter_facts!inner(lead_id)");

    // Person role filter joins decision_makers by role.
    if (personFilter !== "any" && personFilter !== "has")
      embeds.push("dmf:decision_makers!inner(role)");

    const filterEmbeds = embeds.filter(
      (e) => e.startsWith("emf") || e.startsWith("clf") || e.startsWith("lff")
        || e.startsWith("dmf") || e.startsWith("phf")
    );
    const base = forIds
      ? ["id", ...filterEmbeds].join(", ")
      : `id, business_name, website, tags, created_at, custom_fields, ${embeds.join(", ")}`;

    let q = supabase.from("leads").select(base, { count: "exact" });

    if (datasetFilter) q = q.eq("dataset_id", datasetFilter);
    // Full-field search: constrain to ids the RPC matched (empty => no results).
    if (search.trim().length >= 2) q = q.in("id", searchIds ?? []);
    if (emailFilter === "valid") q = q.eq("emf.is_valid_syntax", true);
    if (emailFilter === "invalid") q = q.eq("emf.is_valid_syntax", false);
    if (emailFilter === "none") q = q.is("emf" as never, null);
    if (websiteFilter === "has") q = q.not("website", "is", null);
    if (websiteFilter === "none") q = q.is("website", null);
    if (campaignFilter !== "any" && campaignFilter !== "none")
      q = q.eq("clf.campaign_id", campaignFilter);
    if (campaignFilter === "none") q = q.is("clf" as never, null);
    // Phone: clinic/lead phones live on lead_phones; personal on the facts view.
    if (phoneFilter === "none") q = q.is("phf" as never, null);
    if (phoneFilter === "personal") q = q.eq("lff.has_personal_phone", true);
    if (personFilter === "has") q = q.eq("lff.has_person", true);
    if (personFilter !== "any" && personFilter !== "has") q = q.eq("dmf.role", personFilter);
    if (touchFrom) q = q.gte("lff.first_touch_at", `${touchFrom}T00:00:00`);
    if (touchTo) q = q.lte("lff.first_touch_at", `${touchTo}T23:59:59`);
    if (fieldKey !== "any" && fieldValue.trim())
      q = q.ilike(`custom_fields->>${fieldKey}`, `%${fieldValue.trim()}%`);
    return q;
  }

  const { data, isLoading } = useQuery({
    queryKey: ["leads", filters, searchIds],
    // Wait for search ids before querying so we don't flash all-leads then filter.
    enabled: search.trim().length < 2 || Array.isArray(searchIds),
    queryFn: async () => {
      const [col, dir] = sort.split(".");
      const q = buildQuery()
        .order(col, { ascending: dir === "asc", nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data as unknown as LeadRow[], count: count ?? 0 };
    },
  });

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const ids = new Set<string>(selected);
      for (let from = 0; ; from += 1000) {
        const { data, error } = await buildQuery(true).range(from, from + 999);
        if (error) throw error;
        for (const r of data as unknown as { id: string }[]) ids.add(r.id);
        if (data.length < 1000) break;
      }
      setSelected(ids);
      toast.success(`Selected ${ids.size} leads`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSelectingAll(false);
    }
  }


  const { data: campaigns } = useQuery({
    queryKey: ["campaigns-simple"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name")
        .eq("is_archived", false)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Columns come from the leads actually in view: with a dataset selected only that
  // dataset's (i.e. that sheet's) fields, so unrelated imports don't add empty columns.
  const { data: customFieldKeys } = useQuery({
    queryKey: ["custom-field-keys", datasetFilter],
    queryFn: async () => {
      const keys = new Set<string>();
      for (let from = 0; ; from += 1000) {
        let q = supabase.from("leads").select("custom_fields");
        if (datasetFilter) q = q.eq("dataset_id", datasetFilter);
        const { data, error } = await q.range(from, from + 999);
        if (error) throw error;
        for (const l of data) Object.keys(l.custom_fields ?? {}).forEach((k) => keys.add(k));
        if (data.length < 1000) break;
      }
      return [...keys].sort();
    },
  });

  const allFieldKeys = useMemo(() => customFieldKeys ?? [], [customFieldKeys]);

  const renameField = useMutation({
    mutationFn: async ({ oldKey, newKey }: { oldKey: string; newKey: string }) => {
      const { data, error } = await supabase.rpc("rename_custom_field", {
        p_old: oldKey, p_new: newKey,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count, { oldKey, newKey }) => {
      toast.success(`Renamed "${oldKey}" → "${newKey}" on ${count} leads`);
      setFieldRenames((prev) => ({ ...prev, [oldKey]: "" }));
      queryClient.invalidateQueries({ queryKey: ["custom-field-keys"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteField = useMutation({
    mutationFn: async (key: string) => {
      const { data, error } = await supabase.rpc("delete_custom_field", { p_key: key });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count, key) => {
      toast.success(`Deleted field "${key}" from ${count} leads`);
      queryClient.invalidateQueries({ queryKey: ["custom-field-keys"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const assignCampaign = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const rows = [...selected].map((lead_id) => ({
        user_id: userData.user!.id,
        campaign_id: targetCampaign,
        lead_id,
      }));
      const { error } = await supabase
        .from("campaign_leads")
        .upsert(rows, { onConflict: "campaign_id,lead_id", ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Added ${selected.size} leads to campaign`);
      setCampaignDialog(false);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const addTags = useMutation({
    mutationFn: async () => {
      const newTags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
      const ids = [...selected];
      const { data: current, error } = await supabase
        .from("leads").select("id, tags").in("id", ids);
      if (error) throw error;
      for (const lead of current) {
        const merged = [...new Set([...lead.tags, ...newTags])];
        await supabase.from("leads").update({ tags: merged }).eq("id", lead.id);
      }
    },
    onSuccess: () => {
      toast.success("Tags added");
      setTagDialog(false);
      setTagInput("");
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteSelected = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("leads").delete().in("id", [...selected]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Leads deleted");
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const primaryEmail = (r: LeadRow) =>
    r.lead_emails?.find((e) => e.is_primary)?.email ?? r.lead_emails?.[0]?.email;

  function exportSelected() {
    const rows = (data?.rows ?? []).filter((r) => selected.has(r.id));
    const header = ["Name", "Website", "Email", ...dynamicColumns, "Tags"];
    const csv = [
      header.map((h) => `"${h.replace(/"/g, '""')}"`).join(","),
      ...rows.map((r) =>
        [
          r.business_name,
          r.website ?? "",
          primaryEmail(r) ?? "",
          ...dynamicColumns.map((k) => r.custom_fields?.[k] ?? ""),
          r.tags.join(";"),
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE)),
    [data?.count]
  );

  const allOnPageSelected =
    !!data?.rows.length && data.rows.every((r) => selected.has(r.id));

  // Columns shown by default: only fields that actually carry a value on the current
  // page, so a lead set that never had "Category" doesn't get an all-"—" column.
  const populatedKeys = useMemo(() => {
    const rows = data?.rows ?? [];
    return allFieldKeys.filter((k) =>
      rows.some((r) => (r.custom_fields?.[k] ?? "").toString().trim() !== "")
    );
  }, [allFieldKeys, data?.rows]);

  // User's explicit choice (per dataset) wins over the auto default.
  const dynamicColumns = hiddenColumns
    ? allFieldKeys.filter((k) => !hiddenColumns.includes(k))
    : populatedKeys;

  const hasWebsite = (data?.rows ?? []).some((r) => r.website);
  const hasEmail = (data?.rows ?? []).some((r) => r.lead_emails?.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Leads{" "}
          <span className="text-base font-normal text-muted-foreground">
            ({data?.count ?? "…"})
          </span>
        </h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setColumnsDialog(true)}>
            <Columns3 className="mr-1 h-4 w-4" /> Columns
          </Button>
          <Button variant="ghost" onClick={() => setFieldsDialog(true)}>
            Manage Fields
          </Button>
          <Button asChild variant="outline">
            <Link href="/datasets/import">Import</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name, number, email, any field…"
          className="w-72"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <Select value={emailFilter} onValueChange={(v) => { setEmailFilter(v); setPage(0); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Email: any</SelectItem>
            <SelectItem value="valid">Email: valid syntax</SelectItem>
            <SelectItem value="invalid">Email: invalid syntax</SelectItem>
            <SelectItem value="has">Email: has one</SelectItem>
            <SelectItem value="none">Email: missing</SelectItem>
          </SelectContent>
        </Select>
        <Select value={websiteFilter} onValueChange={(v) => { setWebsiteFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Website: any</SelectItem>
            <SelectItem value="has">Website: has one</SelectItem>
            <SelectItem value="none">Website: missing</SelectItem>
          </SelectContent>
        </Select>
        <Select value={campaignFilter} onValueChange={(v) => { setCampaignFilter(v); setPage(0); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Campaign: any</SelectItem>
            <SelectItem value="none">Not in any campaign</SelectItem>
            {campaigns?.map((c) => (
              <SelectItem key={c.id} value={c.id}>In: {c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={phoneFilter} onValueChange={(v) => { setPhoneFilter(v); setPage(0); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Phone: any</SelectItem>
            <SelectItem value="has">Phone: has one</SelectItem>
            <SelectItem value="none">Phone: missing</SelectItem>
            <SelectItem value="personal">Has personal number</SelectItem>
          </SelectContent>
        </Select>
        <Select value={personFilter} onValueChange={(v) => { setPersonFilter(v); setPage(0); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">People: any</SelectItem>
            <SelectItem value="has">Has a person</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>Role: {r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fieldKey} onValueChange={(v) => { setFieldKey(v); setPage(0); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Field…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Field: any</SelectItem>
            {dynamicColumns.map((k) => (
              <SelectItem key={k} value={k}>{k}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldKey !== "any" && (
          <Input
            placeholder={`${fieldKey} contains…`}
            className="w-44"
            value={fieldValue}
            onChange={(e) => { setFieldValue(e.target.value); setPage(0); }}
          />
        )}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">First touch</span>
          <Input
            type="date"
            className="h-9 w-36"
            value={touchFrom}
            onChange={(e) => { setTouchFrom(e.target.value); setPage(0); }}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            className="h-9 w-36"
            value={touchTo}
            onChange={(e) => { setTouchTo(e.target.value); setPage(0); }}
          />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at.desc">Newest first</SelectItem>
            <SelectItem value="created_at.asc">Oldest first</SelectItem>
            <SelectItem value="business_name.asc">Name A–Z</SelectItem>
            <SelectItem value="business_name.desc">Name Z–A</SelectItem>
          </SelectContent>
        </Select>
        {activeFilterCount > 0 || search.trim() ? (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
        ) : null}
        {(data?.count ?? 0) > 0 && (
          <Button size="sm" variant="secondary" onClick={selectAllMatching} disabled={selectingAll}>
            {selectingAll ? "Selecting…" : `Select all ${data?.count} matching`}
          </Button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCampaignDialog(true)}>
            Add to Campaign
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTagDialog(true)}>
            Add Tags
          </Button>
          <Button size="sm" variant="outline" onClick={exportSelected}>
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              if (confirm(`Delete ${selected.size} leads permanently?`)) deleteSelected.mutate();
            }}
          >
            Delete
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allOnPageSelected}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    data?.rows.forEach((r) => (v ? next.add(r.id) : next.delete(r.id)));
                    setSelected(next);
                  }}
                />
              </TableHead>
              <TableHead className="min-w-48">Name</TableHead>
              {hasWebsite && <TableHead>Website</TableHead>}
              {hasEmail && <TableHead>Email</TableHead>}
              {dynamicColumns.map((k) => (
                <TableHead key={k} className="max-w-48 truncate" title={k}>{k}</TableHead>
              ))}
              <TableHead className="text-right">Campaigns</TableHead>
              <TableHead>Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5 + dynamicColumns.length} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : !data?.rows.length ? (
              <TableRow>
                <TableCell colSpan={5 + dynamicColumns.length} className="py-8 text-center text-muted-foreground">
                  No leads found.
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(r.id); else next.delete(r.id);
                        setSelected(next);
                      }}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/leads/${r.id}`} className="hover:underline">
                      {r.business_name}
                    </Link>
                  </TableCell>
                  {hasWebsite && (
                    <TableCell>
                      {r.website && (
                        <a
                          href={r.website.startsWith("http") ? r.website : `https://${r.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                        >
                          {r.website.replace(/^https?:\/\/(www\.)?/, "").slice(0, 25)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </TableCell>
                  )}
                  {hasEmail && (
                    <TableCell className="max-w-48 truncate text-sm">
                      {primaryEmail(r) ?? "—"}
                    </TableCell>
                  )}
                  {dynamicColumns.map((k) => (
                    <TableCell key={k} className="max-w-48 truncate text-sm" title={r.custom_fields?.[k]}>
                      {r.custom_fields?.[k] ?? "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">{r.campaign_leads?.[0]?.count ?? 0}</TableCell>
                  <TableCell>
                    {r.tags.slice(0, 2).map((t) => (
                      <Badge key={t} variant="secondary" className="mr-1">{t}</Badge>
                    ))}
                    {r.tags.length > 2 && (
                      <span className="text-xs text-muted-foreground">+{r.tags.length - 2}</span>
                    )}
                  </TableCell>
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
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>

      <Dialog open={columnsDialog} onOpenChange={setColumnsDialog}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Columns</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {hiddenColumns
              ? "Showing the fields you picked."
              : "Showing only fields that have values in these leads."}
            {datasetFilter ? " Saved for this dataset." : " Saved for the all-leads view."}
          </p>
          <div className="space-y-2">
            {allFieldKeys.length === 0 && (
              <p className="text-sm text-muted-foreground">No custom fields yet.</p>
            )}
            {allFieldKeys.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={dynamicColumns.includes(k)}
                  onCheckedChange={(v) =>
                    applyHiddenColumns(
                      v
                        ? allFieldKeys.filter(
                            (x) => x !== k && !dynamicColumns.includes(x)
                          )
                        : [...allFieldKeys.filter((x) => !dynamicColumns.includes(x)), k]
                    )
                  }
                />
                <span>{k}</span>
                {!populatedKeys.includes(k) && (
                  <span className="text-xs text-muted-foreground">(empty here)</span>
                )}
              </label>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetColumns}>Reset to auto</Button>
            <Button variant="outline" onClick={() => applyHiddenColumns([])}>Show all</Button>
            <Button onClick={() => setColumnsDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fieldsDialog} onOpenChange={setFieldsDialog}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Fields</DialogTitle>
          </DialogHeader>
          {!customFieldKeys ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !customFieldKeys.length ? (
            <p className="text-sm text-muted-foreground">
              No custom fields yet — they appear after importing a file.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Renaming a field updates it on every lead that has it.
              </p>
              {customFieldKeys.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-40 truncate text-sm font-medium" title={key}>{key}</span>
                  <Input
                    className="h-8 flex-1"
                    placeholder="New name…"
                    value={fieldRenames[key] ?? ""}
                    onChange={(e) =>
                      setFieldRenames((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    disabled={
                      !fieldRenames[key]?.trim() ||
                      fieldRenames[key].trim() === key ||
                      renameField.isPending
                    }
                    onClick={() =>
                      renameField.mutate({ oldKey: key, newKey: fieldRenames[key].trim() })
                    }
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={deleteField.isPending}
                    onClick={() => {
                      if (confirm(`Delete field "${key}" from all leads? This cannot be undone.`))
                        deleteField.mutate(key);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={campaignDialog} onOpenChange={setCampaignDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {selected.size} leads to campaign</DialogTitle></DialogHeader>
          <Select value={targetCampaign} onValueChange={setTargetCampaign}>
            <SelectTrigger><SelectValue placeholder="Choose campaign…" /></SelectTrigger>
            <SelectContent>
              {campaigns?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!campaigns?.length && (
            <p className="text-sm text-muted-foreground">
              No campaigns yet — create one on the Campaigns page first.
            </p>
          )}
          <DialogFooter>
            <Button
              onClick={() => assignCampaign.mutate()}
              disabled={!targetCampaign || assignCampaign.isPending}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tagDialog} onOpenChange={setTagDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add tags to {selected.size} leads</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tags-in">Tags (comma-separated)</Label>
            <Input
              id="tags-in"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="high-priority, london"
            />
          </div>
          <DialogFooter>
            <Button onClick={() => addTags.mutate()} disabled={!tagInput.trim() || addTags.isPending}>
              Add Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsInner />
    </Suspense>
  );
}
