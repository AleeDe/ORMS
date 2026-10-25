"use client";

import { useWorkspaceClient } from "@/components/workspace-provider";

import { useEffect, useState } from "react";
import { useRouter } from "@/lib/workspace-navigation";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Hit = {
  id: string;
  business_name: string;
  website: string | null;
  matched_on: string;
  matched_value: string | null;
};

// Top-bar search that matches a lead by ANY field — name, website, clinic or
// personal email/phone, a person's name, or any custom field value. Built for the
// "unknown number just called, who is this?" case. Opens with the button or Cmd/Ctrl+K.
export function GlobalSearch() {
  const supabase = useWorkspaceClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: hits, isFetching } = useQuery({
    queryKey: ["global-search", q],
    enabled: open && q.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_leads", {
        p_query: q.trim(),
        p_limit: 20,
      });
      if (error) throw error;
      return data as Hit[];
    },
  });

  function go(id: string) {
    setOpen(false);
    setQ("");
    router.push(`/leads/${id}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent md:w-72"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search any lead…</span>
        <kbd className="hidden rounded border px-1.5 text-xs md:inline">⌘K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-24 max-w-xl translate-y-0 gap-0 p-0" showCloseButton={false}>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Name, number, email, website, or any field…"
              className="h-12 border-0 shadow-none focus-visible:ring-0"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {q.trim().length < 2 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Type at least 2 characters. Works with a phone number, email, name — anything.
              </p>
            )}
            {q.trim().length >= 2 && isFetching && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Searching…</p>
            )}
            {q.trim().length >= 2 && !isFetching && !hits?.length && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>
            )}
            {hits?.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => go(h.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{h.business_name}</p>
                  {h.matched_value && (
                    <p className="truncate text-xs text-muted-foreground">{h.matched_value}</p>
                  )}
                </div>
                <Badge variant="secondary" className="shrink-0 text-xs">{h.matched_on}</Badge>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
