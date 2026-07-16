"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  normalizeEmail, normalizeName, normalizePhone, normalizeWebsite, isValidEmailSyntax,
} from "@/lib/normalize";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle } from "lucide-react";

type RawRow = Record<string, string>;
type DupMode = "skip" | "update" | "import";
type ColumnRole = "email" | "website" | "phone" | null;

type ColumnConfig = {
  original: string; // header exactly as it appears in the file
  name: string; // (renamable) name the field is stored under
  include: boolean;
  role: ColumnRole; // detected from the column's VALUES, not its header
  sample: string;
};

type ParsedLead = {
  _row: number;
  _issues: string[];
  _dupOf?: string;
  _dupInFile?: number;
  name: string;
  email: string;
  website: string;
  phone: string;
  custom: Record<string, string>;
};

const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const PHONE_RE = /^[+()\d][\d\s()+-]{6,}$/;

// Detect what a column CONTAINS by sampling its values — header text is irrelevant
function detectRole(values: string[]): ColumnRole {
  const sample = values.filter(Boolean).slice(0, 50);
  if (sample.length < 3) return null;
  const share = (re: RegExp) =>
    sample.filter((v) => re.test(v.trim())).length / sample.length;
  if (share(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/) > 0.6) return "email";
  if (share(URL_RE) > 0.6 && sample.some((v) => /\.|\//.test(v))) return "website";
  if (share(PHONE_RE) > 0.6) return "phone";
  return null;
}

// Guess the display-name column: the most text-like non-role column
function guessNameColumn(configs: ColumnConfig[], rows: RawRow[]): string {
  const scored = configs
    .filter((c) => !c.role)
    .map((c) => {
      const vals = rows.slice(0, 50).map((r) => (r[c.original] ?? "").trim()).filter(Boolean);
      const textish = vals.filter((v) => /[a-z]{2,}/i.test(v) && isNaN(Number(v))).length;
      const bonus = /name|clinic|business|company|practice|title/i.test(c.original) ? 100 : 0;
      return { col: c.original, score: textish + bonus };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.col ?? configs[0]?.original ?? "";
}

export default function ImportPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [configs, setConfigs] = useState<ColumnConfig[]>([]);
  const [nameColumn, setNameColumn] = useState("");
  const [parsed, setParsed] = useState<ParsedLead[]>([]);
  const [dupMode, setDupMode] = useState<DupMode>("import");
  const [datasetId, setDatasetId] = useState("");
  const [newDatasetName, setNewDatasetName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{
    imported: number; updated: number; skippedDup: number; invalid: number; failed: number;
  } | null>(null);

  const { data: datasets } = useQuery({
    queryKey: ["datasets-simple"],
    queryFn: async () => {
      const { data, error } = await supabase.from("datasets").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  function finishParsing(cols: string[], data: RawRow[]) {
    if (!data.length) {
      toast.error("No data rows found in this sheet");
      return;
    }
    const cfgs: ColumnConfig[] = cols.map((c) => {
      const values = data.map((r) => (r[c] ?? "").trim());
      return {
        original: c,
        name: c,
        include: true,
        role: detectRole(values),
        sample: values.find(Boolean) ?? "",
      };
    });
    setConfigs(cfgs);
    setRows(data);
    setNameColumn(guessNameColumn(cfgs, data));
    setStep(2);
  }

  function parseSheet(wb: XLSX.WorkBook, sheetName: string) {
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "" });
    const cols = json.length ? Object.keys(json[0]) : [];
    setActiveSheet(sheetName);
    finishParsing(cols, json.map((r) => {
      const out: RawRow = {};
      for (const k of cols) out[k] = String(r[k] ?? "");
      return out;
    }));
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setWorkbook(null);
    setActiveSheet("");

    if (file.name.toLowerCase().endsWith(".csv")) {
      Papa.parse<RawRow>(file, {
        header: true,
        skipEmptyLines: "greedy",
        complete: (res) => finishParsing(res.meta.fields ?? [], res.data),
        error: () => toast.error("Failed to parse CSV"),
      });
    } else {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      setWorkbook(wb);
      if (wb.SheetNames.length === 1) {
        parseSheet(wb, wb.SheetNames[0]);
      }
      // multiple sheets: the sheet picker (rendered in step 1) takes over
    }
  }

  function updateConfig(original: string, patch: Partial<ColumnConfig>) {
    setConfigs((prev) =>
      prev.map((c) => (c.original === original ? { ...c, ...patch } : c))
    );
  }

  const nameConfigValid = useMemo(() => {
    const c = configs.find((c) => c.original === nameColumn);
    return !!c && c.include;
  }, [configs, nameColumn]);

  // Step 2 -> 3
  async function runValidation() {
    const emailCol = configs.find((c) => c.include && c.role === "email")?.original;
    const websiteCol = configs.find((c) => c.include && c.role === "website")?.original;
    const phoneCol = configs.find((c) => c.include && c.role === "phone")?.original;

    const leads: ParsedLead[] = rows.map((r, i) => {
      const name = (r[nameColumn] ?? "").trim();
      const email = emailCol ? (r[emailCol] ?? "").trim() : "";
      const custom: Record<string, string> = {};
      for (const c of configs) {
        if (!c.include) continue;
        if ([nameColumn, emailCol, websiteCol, phoneCol].includes(c.original)) continue;
        const val = (r[c.original] ?? "").trim();
        if (val) custom[c.name.trim() || c.original] = val;
      }
      const lead: ParsedLead = {
        _row: i + 2,
        _issues: [],
        name,
        email,
        website: websiteCol ? (r[websiteCol] ?? "").trim() : "",
        phone: phoneCol ? (r[phoneCol] ?? "").trim() : "",
        custom,
      };
      if (!name) lead._issues.push("empty name");
      if (email && !isValidEmailSyntax(email)) lead._issues.push("invalid email");
      return lead;
    });

    // in-file duplicates
    const seen = new Map<string, number>();
    for (const l of leads) {
      const keys = [
        normalizeWebsite(l.website) && `w:${normalizeWebsite(l.website)}`,
        normalizeEmail(l.email) && `e:${normalizeEmail(l.email)}`,
        normalizeName(l.name) && `n:${normalizeName(l.name)}`,
        normalizePhone(l.phone) && `p:${normalizePhone(l.phone)}`,
      ].filter(Boolean) as string[];
      const dupKey = keys.find((k) => seen.has(k));
      if (dupKey) l._dupInFile = seen.get(dupKey);
      else keys.forEach((k) => seen.set(k, l._row));
    }

    // DB duplicates
    const existing = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("leads").select("id, website_norm, name_norm").range(from, from + 999);
      if (error) { toast.error(error.message); return; }
      for (const l of data) {
        if (l.website_norm) existing.set(`w:${l.website_norm}`, l.id);
        if (l.name_norm) existing.set(`n:${l.name_norm}`, l.id);
      }
      if (data.length < 1000) break;
    }
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("lead_emails").select("lead_id, email").range(from, from + 999);
      if (error) { toast.error(error.message); return; }
      for (const e of data) existing.set(`e:${e.email.toLowerCase()}`, e.lead_id);
      if (data.length < 1000) break;
    }
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("lead_phones").select("lead_id, phone_norm").range(from, from + 999);
      if (error) { toast.error(error.message); return; }
      for (const p of data) if (p.phone_norm) existing.set(`p:${p.phone_norm}`, p.lead_id);
      if (data.length < 1000) break;
    }

    for (const l of leads) {
      const w = normalizeWebsite(l.website);
      const n = normalizeName(l.name);
      const e = normalizeEmail(l.email);
      const p = normalizePhone(l.phone);
      l._dupOf =
        (w && existing.get(`w:${w}`)) ||
        (e && existing.get(`e:${e}`)) ||
        (p && existing.get(`p:${p}`)) ||
        (n && existing.get(`n:${n}`)) ||
        undefined;
    }

    setParsed(leads);
    setStep(3);
  }

  const stats = useMemo(() => {
    const invalid = parsed.filter((l) => l._issues.length > 0);
    const dups = parsed.filter((l) => !l._issues.length && (l._dupOf || l._dupInFile));
    const clean = parsed.filter((l) => !l._issues.length && !l._dupOf && !l._dupInFile);
    return { invalid, dups, clean };
  }, [parsed]);

  async function runImport() {
    setImporting(true);
    setProgress(0);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user!.id;

      let dsId = datasetId;
      if (dsId === "new") {
        const { data, error } = await supabase
          .from("datasets")
          .insert({ name: newDatasetName, user_id: userId })
          .select("id")
          .single();
        if (error) throw error;
        dsId = data.id;
      }

      let imported = 0, updated = 0, failed = 0;
      const skippedDup = dupMode === "skip" ? stats.dups.length : 0;

      const toLeadRow = (l: ParsedLead) => ({
        user_id: userId,
        dataset_id: dsId || null,
        business_name: l.name,
        website: l.website || null,
        source: activeSheet ? `${fileName} › ${activeSheet}` : fileName,
        website_norm: normalizeWebsite(l.website),
        name_norm: normalizeName(l.name),
        custom_fields: l.custom,
      });

      if (dupMode === "update") {
        for (const l of stats.dups.filter((d) => d._dupOf)) {
          const { error } = await supabase
            .from("leads").update(toLeadRow(l)).eq("id", l._dupOf!);
          if (error) failed++;
          else updated++;
        }
      }

      const toInsert =
        dupMode === "import"
          ? [...stats.clean, ...stats.dups]
          : dupMode === "update"
            ? [...stats.clean, ...stats.dups.filter((d) => !d._dupOf)]
            : stats.clean;

      const CHUNK = 250;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("leads").insert(chunk.map(toLeadRow)).select("id");
        if (error) {
          failed += chunk.length;
        } else {
          imported += data.length;
          const emails = chunk
            .map((l, j) => ({ l, id: data[j]?.id }))
            .filter(({ l, id }) => id && l.email)
            .map(({ l, id }) => ({
              user_id: userId, lead_id: id!, email: l.email.toLowerCase(),
              is_primary: true, is_valid_syntax: isValidEmailSyntax(l.email),
            }));
          const phones = chunk
            .map((l, j) => ({ l, id: data[j]?.id }))
            .filter(({ l, id }) => id && l.phone)
            .map(({ l, id }) => ({
              user_id: userId, lead_id: id!, phone: l.phone,
              phone_norm: normalizePhone(l.phone), is_primary: true,
            }));
          if (emails.length) await supabase.from("lead_emails").insert(emails);
          if (phones.length) await supabase.from("lead_phones").insert(phones);
        }
        setProgress(Math.round(((i + chunk.length) / Math.max(toInsert.length, 1)) * 100));
      }

      setSummary({ imported, updated, skippedDup, invalid: stats.invalid.length, failed });
      setStep(5);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const roleBadge: Record<string, string> = {
    email: "email · dedupe",
    website: "website · dedupe",
    phone: "phone · dedupe",
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import Leads</h1>
        <p className="text-sm text-muted-foreground">
          Step {Math.min(step, 5)} of 5 — Upload → Columns → Validate → Assign & Import → Summary
        </p>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Upload file</CardTitle>
            <CardDescription>
              CSV or XLSX. Your file&apos;s columns are imported exactly as they are — no fixed
              format required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {workbook && workbook.SheetNames.length > 1 && (
              <div className="space-y-2">
                <Label>
                  This file has {workbook.SheetNames.length} sheets — pick one to import
                </Label>
                <div className="grid gap-2 md:grid-cols-2">
                  {workbook.SheetNames.map((sn) => {
                    const ws = workbook.Sheets[sn];
                    const range = ws["!ref"]
                      ? XLSX.utils.decode_range(ws["!ref"]).e.r
                      : 0;
                    return (
                      <button
                        key={sn}
                        type="button"
                        onClick={() => parseSheet(workbook, sn)}
                        className="flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition-colors hover:bg-accent"
                      >
                        <span className="font-medium">{sn}</span>
                        <span className="text-xs text-muted-foreground">~{range} rows</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  You can import the other sheets afterwards — each import run handles one sheet.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Columns</CardTitle>
            <CardDescription>
              {fileName}
              {activeSheet && ` › sheet "${activeSheet}"`} — {rows.length} rows. Every included
              column is imported under the name
              shown below (rename now, or later via &quot;Manage Fields&quot; on the Leads page).
              Just pick which column is the <strong>lead name</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Lead name column (shown in lists &amp; tasks)</Label>
              <Select value={nameColumn} onValueChange={setNameColumn}>
                <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.original} value={c.original}>{c.original}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Use</TableHead>
                  <TableHead>Column (from file)</TableHead>
                  <TableHead>Import as</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>First value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((c) => (
                  <TableRow key={c.original} className={!c.include ? "opacity-50" : ""}>
                    <TableCell>
                      <Checkbox
                        checked={c.include}
                        disabled={c.original === nameColumn}
                        onCheckedChange={(v) => updateConfig(c.original, { include: !!v })}
                      />
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-sm font-medium">
                      {c.original}
                      {c.original === nameColumn && (
                        <Badge className="ml-2" variant="default">lead name</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-44"
                        value={c.name}
                        disabled={!c.include}
                        onChange={(e) => updateConfig(c.original, { name: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      {c.role && (
                        <Badge variant="secondary" className="text-xs">{roleBadge[c.role]}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                      {c.sample}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              Email / website / phone are detected from each column&apos;s <em>values</em> (headers can
              be named anything) and are used for duplicate detection.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={runValidation} disabled={!nameConfigValid}>Validate</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Clean rows</p>
                <p className="text-2xl font-bold text-green-600">{stats.clean.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Possible duplicates</p>
                <p className="text-2xl font-bold text-amber-600">{stats.dups.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">Invalid rows</p>
                <p className="text-2xl font-bold text-destructive">{stats.invalid.length}</p>
              </CardContent>
            </Card>
          </div>

          {stats.invalid.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-destructive" /> Invalid rows (will be skipped)
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.invalid.slice(0, 20).map((l) => (
                      <TableRow key={l._row}>
                        <TableCell>{l._row}</TableCell>
                        <TableCell>{l.name || "—"}</TableCell>
                        <TableCell>
                          {l._issues.map((i) => (
                            <Badge key={i} variant="destructive" className="mr-1">{i}</Badge>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {stats.invalid.length > 20 && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    …and {stats.invalid.length - 20} more
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {stats.dups.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Duplicate handling (optional)</CardTitle>
                <CardDescription>
                  {stats.dups.length} rows look like duplicates (matching website, email, phone,
                  or name — in this file or against existing leads). Nothing is removed
                  automatically — by default everything is imported. Choose skip/update only if
                  you want deduplication.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={dupMode} onValueChange={(v) => setDupMode(v as DupMode)}>
                  <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="import">Import all (no dedupe)</SelectItem>
                    <SelectItem value="skip">Skip duplicates</SelectItem>
                    <SelectItem value="update">Update existing leads</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
            <Button onClick={() => setStep(4)}>Continue</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <Card>
          <CardHeader><CardTitle>Assign dataset &amp; import</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Dataset</Label>
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger className="w-72"><SelectValue placeholder="Choose a dataset…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">+ Create new dataset</SelectItem>
                  {datasets?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {datasetId === "new" && (
              <div className="space-y-2">
                <Label htmlFor="new-ds">New dataset name</Label>
                <Input
                  id="new-ds"
                  className="w-72"
                  value={newDatasetName}
                  onChange={(e) => setNewDatasetName(e.target.value)}
                />
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Importing{" "}
              {dupMode === "import"
                ? stats.clean.length + stats.dups.length
                : dupMode === "update"
                  ? stats.clean.length + stats.dups.filter((d) => !d._dupOf).length
                  : stats.clean.length}{" "}
              leads
              {dupMode === "update" && `, updating ${stats.dups.filter((d) => d._dupOf).length}`}
              {dupMode === "skip" && stats.dups.length > 0 && `, skipping ${stats.dups.length} duplicates`}
              . Invalid rows are skipped.
            </p>
            {importing && (
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(3)} disabled={importing}>Back</Button>
              <Button
                onClick={runImport}
                disabled={importing || !datasetId || (datasetId === "new" && !newDatasetName.trim())}
              >
                {importing ? `Importing… ${progress}%` : "Start Import"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" /> Import complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm">
              <li><strong>{summary.imported}</strong> leads imported</li>
              <li><strong>{summary.updated}</strong> existing leads updated</li>
              <li><strong>{summary.skippedDup}</strong> duplicates skipped</li>
              <li><strong>{summary.invalid}</strong> invalid rows skipped</li>
              <li><strong>{summary.failed}</strong> failed rows</li>
            </ul>
            <div className="flex gap-2">
              <Button onClick={() => router.push("/leads")}>View Leads</Button>
              <Button variant="outline" onClick={() => router.push("/datasets")}>Back to Datasets</Button>
              {workbook && workbook.SheetNames.length > 1 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSummary(null);
                    setParsed([]);
                    setStep(1);
                  }}
                >
                  Import Another Sheet
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
