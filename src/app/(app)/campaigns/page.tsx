"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Megaphone, Archive } from "lucide-react";

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
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaigns", showArchived],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*, campaign_leads(status)")
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
      const { error } = await supabase.from("campaigns").insert({
        name, description: description || null, user_id: userData.user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campaign created");
      setOpen(false); setName(""); setDescription("");
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Show Active" : "Show Archived"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button>New Campaign</Button></DialogTrigger>
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
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !campaigns?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {showArchived ? "No archived campaigns." : "No campaigns yet. Create one and add leads from the Leads table."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">
                    <Link href={`/campaigns/${c.id}`} className="hover:underline">{c.name}</Link>
                  </CardTitle>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                    title={c.is_archived ? "Unarchive" : "Archive"}
                    onClick={() => toggleArchive.mutate(c)}
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                </div>
                {c.description && <CardDescription>{c.description}</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-4 text-sm">
                  <span><strong>{c.total}</strong> leads</span>
                  <span>
                    <strong>{c.total ? Math.round((c.replied / c.total) * 100) : 0}%</strong> reply rate
                  </span>
                  <span><strong>{c.meetings}</strong> meetings</span>
                </div>
                <Badge variant={c.is_archived ? "secondary" : "default"}>
                  {c.is_archived ? "Archived" : "Active"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
