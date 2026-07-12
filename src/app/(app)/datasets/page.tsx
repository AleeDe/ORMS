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
import { Database, Trash2, Upload } from "lucide-react";

type Dataset = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  created_at: string;
  lead_count?: number;
};

export default function DatasetsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: datasets, isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("*, leads(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data.map((d) => ({
        ...d,
        lead_count: d.leads?.[0]?.count ?? 0,
      })) as Dataset[];
    },
  });

  const createDataset = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("datasets").insert({
        name,
        description: description || null,
        user_id: userData.user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dataset created");
      setOpen(false);
      setName("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteDataset = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("datasets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dataset deleted");
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Datasets</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/datasets/import">
              <Upload className="mr-2 h-4 w-4" /> Import Leads
            </Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New Dataset</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Dataset</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ds-name">Name</Label>
                  <Input
                    id="ds-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="UK Dental Clinics"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ds-desc">Description (optional)</Label>
                  <Input
                    id="ds-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createDataset.mutate()}
                  disabled={!name.trim() || createDataset.isPending}
                >
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !datasets?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Database className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No datasets yet. Create one, then import your leads CSV/XLSX.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {datasets.map((d) => (
            <Card key={d.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">
                    <Link href={`/leads?dataset=${d.id}`} className="hover:underline">
                      {d.name}
                    </Link>
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => {
                      if (confirm(`Delete dataset "${d.name}"? Leads remain but lose the dataset link.`))
                        deleteDataset.mutate(d.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {d.description && (
                  <CardDescription>{d.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-2xl font-bold">{d.lead_count}</span>
                <div className="flex items-center gap-2">
                  {d.tags.map((t) => (
                    <Badge key={t} variant="secondary">{t}</Badge>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {new Date(d.created_at).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
