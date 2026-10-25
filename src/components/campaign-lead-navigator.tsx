"use client";

import { useWorkspaceClient } from "@/components/workspace-provider";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "@/lib/workspace-navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { leadHref } from "@/lib/campaign-scope";
import { campaignNeighbors, fetchCampaignLeadOrder, leadShortcut } from "@/lib/campaign-navigation";
import { Button } from "@/components/ui/button";

export function CampaignLeadNavigator({ campaignId, leadId, blocked }: { campaignId: string; leadId: string; blocked: boolean }) {
  const supabase = useWorkspaceClient();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { data: rows, isPending, error, refetch } = useQuery({
    queryKey: ["campaign-lead-order", campaignId],
    queryFn: () => fetchCampaignLeadOrder(supabase, campaignId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { index, total, previous, next } = campaignNeighbors(rows ?? [], leadId);
  const move = useCallback((direction: "next" | "previous") => {
    if (pending || isPending || error) return;
    if (blocked) { toast.info("Save or clear your current draft before changing leads."); return; }
    const target = direction === "next" ? next : previous;
    if (target) startTransition(() => router.push(leadHref(target, campaignId)));
  }, [blocked, campaignId, error, isPending, next, pending, previous, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const direction = leadShortcut(event);
      if (!direction) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role='combobox'], [contenteditable]:not([contenteditable='false'])"))) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='listbox'], [role='menu']")) return;
      if (!rows || index < 0) return;
      event.preventDefault();
      move(direction);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, move, rows]);

  return <div className="space-y-2 rounded-xl border bg-card p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div aria-live="polite"><p className="flex items-center gap-2 text-sm font-semibold">{pending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}{isPending ? "Loading campaign leads…" : error ? "Could not load campaign navigation" : index >= 0 ? `Lead ${index + 1} of ${total}` : "Lead is no longer in this campaign"}</p><p className="mt-0.5 text-xs text-muted-foreground">Full campaign · newest added first</p></div>
      {error ? <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button> : <div className="flex w-full gap-2 sm:w-auto"><Button className="min-h-11 flex-1 gap-1 px-2 sm:flex-none sm:gap-2 sm:px-3" size="sm" variant="outline" aria-keyshortcuts="P" disabled={!previous || blocked || pending} onClick={() => move("previous")}><ArrowLeft className="size-4" /> Previous <kbd className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">P</kbd></Button><Button className="min-h-11 flex-1 gap-1 px-2 sm:flex-none sm:gap-2 sm:px-3" size="sm" aria-keyshortcuts="N" disabled={!next || blocked || pending} onClick={() => move("next")}>Next lead <kbd className="ml-1 rounded border border-current/25 px-1 text-[10px] opacity-70">N</kbd><ArrowRight className="size-4" /></Button></div>}
    </div>
    {blocked && <p className="text-xs text-muted-foreground">Save or clear your draft to move to another lead.</p>}
  </div>;
}
