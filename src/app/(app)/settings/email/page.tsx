"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, RefreshCw, Trash2, Globe, AtSign, ListOrdered, KeyRound, Send, HelpCircle,
} from "lucide-react";
import { toneClass } from "@/lib/badge-styles";
import { MergeFieldInput } from "@/components/merge-field-input";

type Account = {
  id: string;
  label: string;
  key_hint: string;
  domain_count: number;
  created_at: string;
};

type Domain = {
  id: string;
  account_id: string;
  domain: string;
  status: string;
  region: string;
  dns_records: { record: string; name: string; type: string; value: string; priority?: number }[];
  last_checked_at: string | null;
};

type Sender = {
  id: string;
  domain_id: string;
  local_part: string;
  display_name: string;
  reply_to: string | null;
  signature: string | null;
  is_default: boolean;
  email_domains: { domain: string; status: string } | null;
};

type Sequence = {
  id: string;
  name: string;
  description: string | null;
  default_sender_id: string | null;
  stop_on_reply: boolean;
  stop_on_meeting: boolean;
  is_active: boolean;
};

type Step = {
  id: string;
  sequence_id: string;
  position: number;
  delay_days: number;
  subject: string;
  body_template: string;
};

const statusTone = (s: string) =>
  s === "verified" ? "green" : s === "failed" ? "red" : "amber";

// One-line explanation under a field. Keeps the form self-explanatory without
// making the user leave for the full guide.
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export default function EmailSettingsPage() {
  const supabase = createClient();
  const qc = useQueryClient();

  // Never selects api_key_encrypted — the key must not reach the browser.
  const { data: accounts } = useQuery({
    queryKey: ["email-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_accounts")
        .select("id, label, key_hint, domain_count, created_at")
        .order("created_at");
      if (error) throw error;
      return data as Account[];
    },
  });

  const { data: domains } = useQuery({
    queryKey: ["email-domains"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_domains").select("*").order("created_at");
      if (error) throw error;
      return data as Domain[];
    },
  });

  const { data: senders } = useQuery({
    queryKey: ["email-senders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_senders")
        .select("*, email_domains(domain, status)")
        .order("created_at");
      if (error) throw error;
      return data as unknown as Sender[];
    },
  });

  const { data: sequences } = useQuery({
    queryKey: ["email-sequences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences").select("*").order("created_at");
      if (error) throw error;
      return data as Sequence[];
    },
  });

  // --- Accounts ----------------------------------------------------------
  const [keyForm, setKeyForm] = useState({ apiKey: "", label: "" });

  const connectAccount = useMutation({
    mutationFn: async (f: typeof keyForm) => {
      const res = await fetch("/api/email/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });

      // A crashed route returns an HTML error page, not JSON — parsing that
      // blind turns a real cause into an unhelpful "Something went wrong".
      const raw = await res.text();
      let json: { error?: string; domains?: { name: string; status: string }[] };
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(
          res.status === 401
            ? "Your session expired — sign in again."
            : `Server error (${res.status}). Check the dev server console for the cause.`
        );
      }

      if (!res.ok) throw new Error(json.error || `Could not connect (${res.status})`);
      return json as {
        domains: { name: string; status: string }[];
        webhookRegistered?: boolean;
        webhookError?: string | null;
      };
    },
    onSuccess: (r) => {
      toast.success(
        r.domains.length
          ? `Connected — ${r.domains.length} domain(s): ${r.domains.map((d) => d.name).join(", ")}`
          : "Connected — no domains in this Resend account yet"
      );
      // Without the webhook, sent mail never leaves the Scheduled tab. The
      // account still works, so this is a warning rather than a failure — but it
      // must not be silent, which is how it went unnoticed before.
      if (r.webhookError) {
        toast.warning(`Delivery tracking is not active: ${r.webhookError}`, {
          duration: 10000,
        });
      }
      setKeyForm({ apiKey: "", label: "" });
      qc.invalidateQueries({ queryKey: ["email-accounts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const disconnectAccount = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/email/accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      // A crashed route returns HTML, and parsing that blind previously turned a
      // real failure into a success toast while the account stayed in the list.
      const raw = await res.text();
      let json: { error?: string };
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`Server error (${res.status}) — the account was not removed.`);
      }
      if (!res.ok) throw new Error(json.error || "Could not disconnect");
    },
    onSuccess: () => {
      toast.success("Disconnected — its domains were removed too");
      qc.invalidateQueries({ queryKey: ["email-accounts"] });
      qc.invalidateQueries({ queryKey: ["email-domains"] });
      qc.invalidateQueries({ queryKey: ["email-senders"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // --- Domains -----------------------------------------------------------
  const [newDomain, setNewDomain] = useState("");
  const [domainAccount, setDomainAccount] = useState("");

  const addDomain = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/email/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newDomain, accountId: domainAccount }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not add domain");
      return json as { adopted: boolean };
    },
    onSuccess: (r) => {
      toast.success(
        r.adopted
          ? "Domain was already in that Resend account — added to ORMS"
          : "Domain registered — publish its DNS records, then verify"
      );
      setNewDomain("");
      qc.invalidateQueries({ queryKey: ["email-domains"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const verify = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/email/domains/${id}/verify`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Verification failed");
      return json.domain as Domain;
    },
    onSuccess: (d) => {
      toast[d.status === "verified" ? "success" : "info"](
        d.status === "verified"
          ? `${d.domain} is verified — you can send from it now`
          : `${d.domain} is still ${d.status}. DNS can take a while to propagate.`
      );
      qc.invalidateQueries({ queryKey: ["email-domains"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // --- Senders -----------------------------------------------------------
  const [senderForm, setSenderForm] = useState({
    domain_id: "", local_part: "", display_name: "", reply_to: "", signature: "",
  });

  const addSender = useMutation({
    mutationFn: async (f: typeof senderForm) => {
      const { data: u } = await supabase.auth.getUser();
      const isFirst = (senders ?? []).length === 0;
      const { error } = await supabase.from("email_senders").insert({
        user_id: u.user!.id,
        domain_id: f.domain_id,
        local_part: f.local_part.trim().toLowerCase(),
        display_name: f.display_name.trim(),
        reply_to: f.reply_to.trim() || null,
        signature: f.signature.trim() || null,
        is_default: isFirst,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sender added");
      setSenderForm({ domain_id: "", local_part: "", display_name: "", reply_to: "", signature: "" });
      qc.invalidateQueries({ queryKey: ["email-senders"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // Sends a real email to the user so they can confirm the whole chain works
  // (key → domain → DNS → inbox) before any lead is contacted.
  const [testTarget, setTestTarget] = useState<{ id: string; to: string } | null>(null);

  const sendTest = useMutation({
    mutationFn: async ({ senderId, to }: { senderId: string; to: string }) => {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId, to }),
      });
      const raw = await res.text();
      let json: { error?: string; to?: string };
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`Server error (${res.status}) — check the dev server console.`);
      }
      if (!res.ok) throw new Error(json.error || "Test send failed");
      return json as { to: string };
    },
    onSuccess: (r) => {
      toast.success(`Test email sent to ${r.to} — check your inbox (and spam)`);
      setTestTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteSender = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_senders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sender removed");
      qc.invalidateQueries({ queryKey: ["email-senders"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // --- Sequences ---------------------------------------------------------
  const [seqForm, setSeqForm] = useState({ name: "", description: "", default_sender_id: "" });
  const [openSeq, setOpenSeq] = useState<string | null>(null);

  const addSequence = useMutation({
    mutationFn: async (f: typeof seqForm) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("email_sequences").insert({
        user_id: u.user!.id,
        name: f.name.trim(),
        description: f.description.trim() || null,
        default_sender_id: f.default_sender_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sequence created — add its steps below");
      setSeqForm({ name: "", description: "", default_sender_id: "" });
      qc.invalidateQueries({ queryKey: ["email-sequences"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateSequence = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Sequence> }) => {
      const { error } = await supabase.from("email_sequences").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-sequences"] }),
    onError: (e) => toast.error(e.message),
  });

  // email_enrollments.sequence_id is ON DELETE CASCADE, so deleting a sequence
  // that has ever been used would silently erase that enrolment history (and the
  // queue rows hanging off it). Only genuinely unused sequences may be deleted;
  // anything with history is deactivated instead, which is what the user
  // actually wants for a finished campaign.
  const deleteSequence = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_sequences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sequence deleted");
      qc.invalidateQueries({ queryKey: ["email-sequences"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const requestDeleteSequence = (seq: Sequence, enrollmentCount: number) => {
    if (enrollmentCount > 0) {
      toast.error(
        `"${seq.name}" has ${enrollmentCount} enrolled lead${enrollmentCount === 1 ? "" : "s"}. ` +
          `Deleting it would erase that history — turn Active off instead to retire it.`,
        { duration: 7000 }
      );
      return;
    }
    if (!confirm(`Delete "${seq.name}"? It has never been used, so nothing is lost.`)) return;
    deleteSequence.mutate(seq.id);
  };

  const verifiedDomains = (domains ?? []).filter((d) => d.status === "verified");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Email &amp; Sequences</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sending runs through Resend. Connect as many Resend accounts as you have, add as many
            domains as you need — one per product — and they all stay active at once.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Set up in order: <strong>account → domain → DNS → sender → test → sequence</strong>.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/help/email">
            <HelpCircle className="h-4 w-4 mr-1" /> Setup guide
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts"><KeyRound className="h-4 w-4 mr-1" /> Resend accounts</TabsTrigger>
          <TabsTrigger value="domains"><Globe className="h-4 w-4 mr-1" /> Domains</TabsTrigger>
          <TabsTrigger value="senders"><AtSign className="h-4 w-4 mr-1" /> Senders</TabsTrigger>
          <TabsTrigger value="sequences"><ListOrdered className="h-4 w-4 mr-1" /> Sequences</TabsTrigger>
        </TabsList>

        {/* ---------------- Accounts ---------------- */}
        <TabsContent value="accounts" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connect a Resend account</CardTitle>
              <CardDescription>
                A domain lives in exactly one Resend account. If your domains are spread across
                several Resend logins, connect each one here and ORMS will use them together.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>API key</Label>
                  <Input
                    type="password"
                    placeholder="re_…"
                    value={keyForm.apiKey}
                    onChange={(e) => setKeyForm({ ...keyForm, apiKey: e.target.value })}
                  />
                  <Hint>
                    Resend → API Keys → Create API Key. Permission must be{" "}
                    <strong>Full access</strong> — a &quot;Sending access&quot; key cannot manage domains.
                  </Hint>
                </div>
                <div className="space-y-1">
                  <Label>Label (optional)</Label>
                  <Input
                    placeholder="ReviewYourDoctor Gmail"
                    value={keyForm.label}
                    onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })}
                  />
                  <Hint>A name so you can tell your Resend accounts apart.</Hint>
                </div>
              </div>
              <Button
                onClick={() => connectAccount.mutate(keyForm)}
                disabled={!keyForm.apiKey.trim() || connectAccount.isPending}
              >
                <Plus className="h-4 w-4 mr-1" />
                {connectAccount.isPending ? "Checking…" : "Connect"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Create the key at resend.com → API Keys with <strong>Full access</strong> —
                sending-only keys cannot register domains. The key is encrypted before it is
                stored and is never shown again after you save it.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Domains in ORMS</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(accounts ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.label}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {a.key_hint}
                      </TableCell>
                      <TableCell>
                        {(domains ?? []).filter((d) => d.account_id === a.id).length}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => disconnectAccount.mutate(a.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!accounts?.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
                        No Resend account connected yet — paste a key above to start.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Domains ---------------- */}
        <TabsContent value="domains" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Add a domain</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!accounts?.length ? (
                <p className="text-sm text-muted-foreground">
                  Connect a Resend account first — domains are registered under one.
                </p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Domain</Label>
                      <Input
                        placeholder="reviewyourdoctor.co.uk"
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                      />
                      <Hint>Bare domain only — no https://, no www.</Hint>
                    </div>
                    <div className="space-y-1">
                      <Label>Register under</Label>
                      <Select value={domainAccount} onValueChange={setDomainAccount}>
                        <SelectTrigger><SelectValue placeholder="Pick a Resend account" /></SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.label} ({a.key_hint})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Hint>
                        If the domain already exists in one of your Resend accounts, pick that one —
                        it gets adopted, not re-registered.
                      </Hint>
                    </div>
                  </div>
                  <Button
                    onClick={() => addDomain.mutate()}
                    disabled={!newDomain.trim() || !domainAccount || addDomain.isPending}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Pick the account the domain already belongs to — if it was registered under a
                different Resend login, that account&apos;s key must be connected first.
                Resend generates the DNS records and decides when a domain is verified; ORMS only
                shows its answer. Publish the records in Cloudflare, then hit Verify.
                Keep a single SPF TXT record: if Cloudflare Email Routing already added one,
                merge Resend&apos;s include into it rather than adding a second.
              </p>
            </CardContent>
          </Card>

          {(domains ?? []).map((d) => (
            <Card key={d.id}>
              <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  {d.domain}
                  <Badge className={toneClass(statusTone(d.status))}>{d.status}</Badge>
                </CardTitle>
                <Button
                  size="sm" variant="outline"
                  onClick={() => verify.mutate(d.id)}
                  disabled={verify.isPending}
                >
                  <RefreshCw className="h-4 w-4 mr-1" /> Verify
                </Button>
              </CardHeader>
              <CardContent>
                {d.dns_records?.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Record</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.dns_records.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="whitespace-nowrap">{r.record}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.type}</TableCell>
                            <TableCell className="font-mono text-xs break-all">{r.name}</TableCell>
                            <TableCell className="font-mono text-xs break-all">
                              {r.value}{r.priority != null ? ` (priority ${r.priority})` : ""}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No DNS records returned.</p>
                )}
              </CardContent>
            </Card>
          ))}
          {!domains?.length && (
            <p className="text-sm text-muted-foreground">No domains yet.</p>
          )}
        </TabsContent>

        {/* ---------------- Senders ---------------- */}
        <TabsContent value="senders" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Add a sender</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!verifiedDomains.length && (
                <p className="text-sm text-muted-foreground">
                  Verify a domain first — senders can only be created on a verified domain.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Domain</Label>
                  <Select
                    value={senderForm.domain_id}
                    onValueChange={(v) => setSenderForm({ ...senderForm, domain_id: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Pick a domain" /></SelectTrigger>
                    <SelectContent>
                      {verifiedDomains.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.domain}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Address</Label>
                  <Input
                    placeholder="sarah"
                    value={senderForm.local_part}
                    onChange={(e) => setSenderForm({ ...senderForm, local_part: e.target.value })}
                  />
                  <Hint>
                    Just the part before the @ — becomes{" "}
                    <code>
                      {senderForm.local_part.trim() || "sarah"}@
                      {verifiedDomains.find((d) => d.id === senderForm.domain_id)?.domain ||
                        "yourdomain.com"}
                    </code>
                  </Hint>
                </div>
                <div className="space-y-1">
                  <Label>Display name</Label>
                  <Input
                    placeholder="Sarah from ReviewYourDoctor"
                    value={senderForm.display_name}
                    onChange={(e) => setSenderForm({ ...senderForm, display_name: e.target.value })}
                  />
                  <Hint>
                    The name leads see in their inbox. A real person&apos;s name usually reads better
                    than a company name.
                  </Hint>
                </div>
                <div className="space-y-1">
                  <Label>Reply-to (optional)</Label>
                  <Input
                    placeholder="Where replies should land"
                    value={senderForm.reply_to}
                    onChange={(e) => setSenderForm({ ...senderForm, reply_to: e.target.value })}
                  />
                  <Hint>
                    Blank = replies go to the sending address. Make sure you can actually read
                    whatever you put here — every lead&apos;s answer lands there.
                  </Hint>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Signature (optional — appended to every send)</Label>
                <Textarea
                  rows={3}
                  value={senderForm.signature}
                  onChange={(e) => setSenderForm({ ...senderForm, signature: e.target.value })}
                />
                <Hint>Plain text, added to the bottom of every email from this sender.</Hint>
              </div>
              <Button
                onClick={() => addSender.mutate(senderForm)}
                disabled={
                  !senderForm.domain_id || !senderForm.local_part.trim() ||
                  !senderForm.display_name.trim() || addSender.isPending
                }
              >
                <Plus className="h-4 w-4 mr-1" /> Add sender
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Address</TableHead>
                    <TableHead>Display name</TableHead>
                    <TableHead>Reply-to</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(senders ?? []).map((s) => (
                    <Fragment key={s.id}>
                      <TableRow>
                        <TableCell className="font-mono text-sm">
                          {s.local_part}@{s.email_domains?.domain}
                          {s.is_default && <Badge variant="outline" className="ml-2">Default</Badge>}
                          {s.email_domains?.status !== "verified" && (
                            <Badge className={`ml-2 ${toneClass("amber")}`}>
                              domain not verified
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{s.display_name}</TableCell>
                        <TableCell className="text-muted-foreground">{s.reply_to || "—"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button
                            size="sm" variant="outline" className="mr-1"
                            onClick={() =>
                              setTestTarget(
                                testTarget?.id === s.id ? null : { id: s.id, to: "" }
                              )
                            }
                          >
                            <Send className="h-4 w-4 mr-1" /> Send test
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => deleteSender.mutate(s.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {testTarget?.id === s.id && (
                        <TableRow>
                          <TableCell colSpan={4} className="bg-muted/40">
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">
                                Sends a <strong>real</strong> email from{" "}
                                <code>{s.local_part}@{s.email_domains?.domain}</code>. Leave blank to
                                send to your own account address. Reply to it to check where replies land.
                              </p>
                              <div className="flex gap-2">
                                <Input
                                  placeholder="you@example.com (optional)"
                                  value={testTarget.to}
                                  onChange={(e) =>
                                    setTestTarget({ ...testTarget, to: e.target.value })
                                  }
                                  className="max-w-sm"
                                />
                                <Button
                                  size="sm"
                                  disabled={sendTest.isPending}
                                  onClick={() =>
                                    sendTest.mutate({ senderId: s.id, to: testTarget.to })
                                  }
                                >
                                  {sendTest.isPending ? "Sending…" : "Send test email"}
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  onClick={() => setTestTarget(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                  {!senders?.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
                        No senders yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Sequences ---------------- */}
        <TabsContent value="sequences" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">New sequence</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input
                    placeholder="Cold Outreach"
                    value={seqForm.name}
                    onChange={(e) => setSeqForm({ ...seqForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Sends from</Label>
                  <Select
                    value={seqForm.default_sender_id}
                    onValueChange={(v) => setSeqForm({ ...seqForm, default_sender_id: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Pick a sender" /></SelectTrigger>
                    <SelectContent>
                      {(senders ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.local_part}@{s.email_domains?.domain}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={() => addSequence.mutate(seqForm)}
                disabled={!seqForm.name.trim() || addSequence.isPending}
              >
                <Plus className="h-4 w-4 mr-1" /> Create sequence
              </Button>
            </CardContent>
          </Card>

          {(sequences ?? []).map((seq) => (
            <SequenceCard
              key={seq.id}
              sequence={seq}
              senders={senders ?? []}
              open={openSeq === seq.id}
              onToggle={() => setOpenSeq(openSeq === seq.id ? null : seq.id)}
              onUpdate={(patch) => updateSequence.mutate({ id: seq.id, patch })}
              onDelete={(count) => requestDeleteSequence(seq, count)}
            />
          ))}
          {!sequences?.length && (
            <p className="text-sm text-muted-foreground">No sequences yet.</p>
          )}
        </TabsContent>
      </Tabs>

      <p className="text-sm text-muted-foreground">
        Prepared emails land in{" "}
        <Link href="/emails" className="underline">Ready to Review</Link>. Nothing is ever sent
        automatically.
      </p>
    </div>
  );
}

// One sequence with its steps. Steps are business-day delays measured from the
// previous step's send, so a paused or late send shifts everything after it.
function SequenceCard({
  sequence, senders, open, onToggle, onUpdate, onDelete,
}: {
  sequence: Sequence;
  senders: Sender[];
  open: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<Sequence>) => void;
  /** Receives the enrolment count so the parent can refuse a destructive delete. */
  onDelete?: (enrollmentCount: number) => void;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [form, setForm] = useState({ delay_days: 3, subject: "", body_template: "" });

  const { data: steps } = useQuery({
    queryKey: ["sequence-steps", sequence.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequence_steps")
        .select("*").eq("sequence_id", sequence.id).order("position");
      if (error) throw error;
      return data as Step[];
    },
  });

  const addStep = useMutation({
    mutationFn: async (f: typeof form) => {
      const { data: u } = await supabase.auth.getUser();
      const nextPos = (steps?.length ?? 0) + 1;
      const { error } = await supabase.from("email_sequence_steps").insert({
        user_id: u.user!.id,
        sequence_id: sequence.id,
        position: nextPos,
        // Step 1 defaults to same-day so a new enrolment shows up immediately.
        delay_days: nextPos === 1 ? 0 : f.delay_days,
        subject: f.subject.trim(),
        body_template: f.body_template,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Step added");
      setForm({ delay_days: 3, subject: "", body_template: "" });
      qc.invalidateQueries({ queryKey: ["sequence-steps", sequence.id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteStep = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_sequence_steps").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sequence-steps", sequence.id] });
    },
    onError: (e) => toast.error(e.message),
  });

  // How many leads have ever been enrolled. Shown on the card so you can tell a
  // dead test sequence from one carrying real history, and used to gate delete.
  const { data: enrollmentCount } = useQuery({
    queryKey: ["sequence-enrollment-count", sequence.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("email_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("sequence_id", sequence.id);
      return count ?? 0;
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          {sequence.name}
          {!sequence.is_active && <Badge variant="outline" className="ml-2">Inactive</Badge>}
          {!!enrollmentCount && (
            <Badge variant="secondary" className="ml-2 font-normal">
              {enrollmentCount} enrolled
            </Badge>
          )}
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onToggle}>
            {open ? "Close" : "Edit steps"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={enrollmentCount === undefined || onDelete === undefined}
            onClick={() => onDelete?.(enrollmentCount ?? 0)}
            title={
              enrollmentCount
                ? "This sequence has enrolment history"
                : "Delete this sequence"
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={sequence.stop_on_reply}
                onCheckedChange={(v) => onUpdate({ stop_on_reply: v })}
              />
              Stop when the lead replies
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={sequence.stop_on_meeting}
                onCheckedChange={(v) => onUpdate({ stop_on_meeting: v })}
              />
              Stop when a meeting is booked
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={sequence.is_active}
                onCheckedChange={(v) => onUpdate({ is_active: v })}
              />
              Active
            </label>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Sends from</Label>
            <Select
              value={sequence.default_sender_id ?? ""}
              onValueChange={(v) => onUpdate({ default_sender_id: v })}
            >
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder="Pick a sender" />
              </SelectTrigger>
              <SelectContent>
                {senders.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.local_part}@{s.email_domains?.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            {(steps ?? []).map((st) => (
              <div key={st.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Step {st.position}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {st.position === 1
                        ? "Sent when enrolled"
                        : `${st.delay_days} business days after step ${st.position - 1}`}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => deleteStep.mutate(st.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-sm font-medium mt-2">{st.subject}</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">
                  {st.body_template}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-sm font-medium">Add step {(steps?.length ?? 0) + 1}</p>
            {(steps?.length ?? 0) > 0 ? (
              <div className="space-y-1">
                <Label className="text-xs">Wait how long before this one?</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={0} className="w-20"
                    value={form.delay_days}
                    onChange={(e) => setForm({ ...form, delay_days: Number(e.target.value) })}
                  />
                  <span className="text-sm text-muted-foreground">
                    working days after you send step {steps?.length ?? 1}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Weekends are skipped. The clock starts when you actually send the previous
                  email, not when it was due.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                This is the first email — it&apos;s ready to send as soon as you enrol a lead.
              </p>
            )}
            <MergeFieldInput
              subject={form.subject}
              body={form.body_template}
              onSubjectChange={(v) => setForm({ ...form, subject: v })}
              onBodyChange={(v) => setForm({ ...form, body_template: v })}
            />
            <Button
              size="sm"
              onClick={() => addStep.mutate(form)}
              disabled={!form.subject.trim() || !form.body_template.trim() || addStep.isPending}
            >
              <Plus className="h-4 w-4 mr-1" /> Add step
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
