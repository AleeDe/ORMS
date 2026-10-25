"use client";

import { useWorkspaceClient, useWorkspaceDraft } from "@/components/workspace-provider";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { CHANNEL_LABELS, CHANNEL_ORDER, isContactChannel, type ContactChannel } from "@/lib/people";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CampaignChannelSettings({ campaignId, initial }: { campaignId: string; initial: ContactChannel | null }) {
  const supabase = useWorkspaceClient();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial ?? "per_touch");
  useWorkspaceDraft(value !== (initial ?? "per_touch"));
  const save = useMutation({
    mutationFn: async () => {
      const channel = value === "per_touch" ? null : value;
      if (channel !== null && !isContactChannel(channel)) throw new Error("Choose a valid outreach channel.");
      const { data, error } = await supabase.from("campaigns").update({ default_channel: channel })
        .eq("id", campaignId).select("id, default_channel").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      const channel = saved.default_channel as ContactChannel | null;
      toast.success(channel ? `Campaign channel fixed to ${CHANNEL_LABELS[channel]}` : "Channel can be chosen for each touch");
      queryClient.setQueryData(["campaign", campaignId], (current: Record<string, unknown> | undefined) => current ? { ...current, default_channel: channel } : current);
      queryClient.invalidateQueries({ queryKey: ["lead"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return <Card>
    <CardHeader className="pb-0"><CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="size-4 text-primary" /> Outreach channel</CardTitle><CardDescription>Set a fixed channel for every lead in this campaign, or choose one for each touch.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full space-y-2 sm:w-72"><Label htmlFor="campaign-channel">Channel used</Label><Select value={value} onValueChange={setValue} disabled={save.isPending}><SelectTrigger id="campaign-channel" className="min-h-11 bg-background/50"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="per_touch">Choose per touch</SelectItem>{CHANNEL_ORDER.map((channel) => <SelectItem key={channel} value={channel}>{CHANNEL_LABELS[channel]}</SelectItem>)}</SelectContent></Select></div>
        <Button className="min-h-11" disabled={save.isPending || value === (initial ?? "per_touch")} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save channel"}</Button>
        {initial && <p className="flex min-h-11 items-center gap-1.5 text-xs text-primary"><LockKeyhole className="size-3.5" /> Fixed for this campaign</p>}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Applies to new outreach. Existing history keeps its recorded channel.</p>
    </CardContent>
  </Card>;
}
