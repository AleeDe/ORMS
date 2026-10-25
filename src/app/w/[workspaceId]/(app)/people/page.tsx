"use client";

import { useWorkspaceClient } from "@/components/workspace-provider";

import { useState } from "react";
import Link from "@/components/workspace-link";
import { useQuery } from "@tanstack/react-query";
import { ROLE_OPTIONS } from "@/lib/people";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExternalLink } from "lucide-react";

const PAGE_SIZE = 50;

type PersonRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  personal_email: string | null;
  personal_phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  lead_id: string;
  leads: { id: string; business_name: string } | null;
};

export default function PeoplePage() {
  const supabase = useWorkspaceClient();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("any");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["people", search, role, page],
    queryFn: async () => {
      let q = supabase
        .from("decision_makers")
        .select(
          "id, name, role, email, phone, personal_email, personal_phone, linkedin_url, notes, lead_id, leads!decision_makers_lead_id_fkey(id, business_name)",
          { count: "exact" }
        )
        .order("name");
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      if (role !== "any") q = q.eq("role", role);
      const { data, count, error } = await q.range(
        page * PAGE_SIZE,
        page * PAGE_SIZE + PAGE_SIZE - 1
      );
      if (error) throw error;
      return { rows: data as unknown as PersonRow[], count: count ?? 0 };
    },
  });

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          People{" "}
          <span className="text-base font-normal text-muted-foreground">
            ({data?.count ?? "…"})
          </span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Everyone you deal with, and the lead they belong to. Add people from a lead&apos;s page.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name…"
          className="w-56"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All roles</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Associated with</TableHead>
              <TableHead>Personal number</TableHead>
              <TableHead>Personal email</TableHead>
              <TableHead>LinkedIn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !data?.rows.length && (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  No people yet — open a lead and add the owner, manager, or receptionist.
                </TableCell>
              </TableRow>
            )}
            {data?.rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  {p.role ? <Badge variant="secondary">{p.role}</Badge> : "—"}
                </TableCell>
                <TableCell>
                  {p.leads ? (
                    <Link href={`/leads/${p.lead_id}`} className="text-primary hover:underline">
                      {p.leads.business_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-sm">{p.personal_phone || p.phone || "—"}</TableCell>
                <TableCell className="max-w-56 truncate text-sm">
                  {p.personal_email || p.email || "—"}
                </TableCell>
                <TableCell>
                  {p.linkedin_url ? (
                    <a
                      href={p.linkedin_url.startsWith("http") ? p.linkedin_url : `https://${p.linkedin_url}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      Profile <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline" size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline" size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
