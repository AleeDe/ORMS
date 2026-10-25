"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import { useRouter } from "@/lib/workspace-navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace, useWorkspaceClient, useWorkspaceDraft } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Megaphone, Archive, ArrowUpRight, Plus } from "lucide-react";
import { WorkflowHeader } from "@/components/workflow-header";

type CampaignCard = {
  id: string;
  name: string;
  description: string | null;
  is_archived: boolean;
  created_at: string;
  total: number;
  replied: number;
  meetings: number;
};

export default function CampaignsPage() {
  const { isOwner, role } = useWorkspace();
  const supabase = useWorkspaceClient();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  useWorkspaceDraft(open && Boolean(name.trim() || description.trim()));

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaigns", showArchived],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*, campaign_leads!campaign_leads_campaign_id_fkey(status)")
        .eq("is_archived", showArchived)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data.map((c) => {
        const statuses = (c.campaign_leads ?? []) as { status: string }[];
        const replied = statuses.filter((s) =>
          ["replied", "interested_meeting", "won"].includes(s.status)
        ).length;
        const meetings = statuses.filter((s) =>
          ["interested_meeting", "won"].includes(s.status)
        ).length;
        return {
          ...c,
          total: statuses.length,
          replied,
          meetings,
        } as CampaignCard;
      });
    },
  });

  const createCampaign = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("campaigns").insert({
        name, description: description || null, user_id: userData.user!.id,
      }).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (campaign) => {
      toast.success("Campaign created");
      setOpen(false); setName(""); setDescription("");
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns-simple"] });
      router.push(`/campaigns/${campaign.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleArchive = useMutation({
    mutationFn: async (c: CampaignCard) => {
      const { error } = await supabase
        .from("campaigns")
        .update({ is_archived: !c.is_archived })
        .eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  return (
    <div className="space-y-6">
      <WorkflowHeader step={3} showSteps={isOwner} title={isOwner ? "Turn leads into conversations" : "Your campaigns"} description={isOwner ? "Give each outreach effort a space of its own. Add leads from your library, then track touches, follow-ups, and results independently." : "Open an assigned campaign to work through leads, log outreach, and keep your next actions on track."} actions={<>
          <Button variant="ghost" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Show Active" : "Show Archived"}
          </Button>
          {isOwner && <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 size-4" /> New campaign</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Campaign</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="c-name">Name</Label>
                  <Input
                    id="c-name" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Review Your Doctor — UK June"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="c-desc">Description (optional)</Label>
                  <Input id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => createCampaign.mutate()} disabled={!name.trim() || createCampaign.isPending}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>}
        </>} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !campaigns?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {showArchived ? "No archived campaigns." : isOwner ? "No campaigns yet. Create one and add leads from the Leads table." : "No campaigns assigned yet. Your workspace owner can grant access from Team & access."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <Card key={c.id} className="group overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md motion-reduce:transform-none">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">
                    <Link href={`/campaigns/${c.id}`} className="hover:underline">{c.name}</Link>
                  </CardTitle>
                  {isOwner && <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                    title={c.is_archived ? "Unarchive" : "Archive"} aria-label={`${c.is_archived ? "Unarchive" : "Archive"} ${c.name}`}
                    onClick={() => toggleArchive.mutate(c)}
                  >
                    <Archive className="h-4 w-4" />
                  </Button>}
                </div>
                {c.description && <CardDescription>{c.description}</CardDescription>}
                {!isOwner && <Badge variant="secondary" className="w-fit capitalize">{role(c.id)}</Badge>}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 text-sm">
                  <span><strong>{c.total}</strong> leads</span>
                  <span>
                    <strong>{c.total ? Math.round((c.replied / c.total) * 100) : 0}%</strong> reply rate
                  </span>
                  <span><strong>{c.meetings}</strong> meetings</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-primary to-teal-400" style={{ width: `${c.total ? (c.replied / c.total) * 100 : 0}%` }} /></div>
                <div className="flex items-center justify-between"><Badge variant={c.is_archived ? "secondary" : "default"}>
                  {c.is_archived ? "Archived" : "Active"}
                </Badge><Link href={`/campaigns/${c.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary">Open workspace <ArrowUpRight className="size-4" /></Link></div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
