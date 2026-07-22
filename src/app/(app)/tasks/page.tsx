"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { todayStr } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import { AddToCalendar } from "@/components/add-to-calendar";
import { dueTone, priorityClass, toneClass } from "@/lib/badge-styles";

type Task = {
  id: string;
  title: string;
  type: string;
  due_date: string;
  priority: string;
  status: string;
  leads: { id: string; business_name: string } | null;
  campaigns: { name: string } | null;
};

export default function TasksPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const today = todayStr();
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ title: "", due_date: today, lead_id: "" });

  const { data: tasks } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, type, due_date, priority, status, leads(id, business_name), campaigns(name)")
        .order("due_date");
      if (error) throw error;
      return data as unknown as Task[];
    },
  });

  const { data: noNextStep } = useQuery({
    queryKey: ["no-next-step"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("no_next_step_leads")
        .select("id, business_name, website")
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  // Lightweight lead list for the "add task" lead picker (searchable via typing).
  const [leadSearch, setLeadSearch] = useState("");
  const { data: leadOptions } = useQuery({
    queryKey: ["task-lead-options", leadSearch],
    queryFn: async () => {
      let q = supabase.from("leads").select("id, business_name").order("business_name").limit(20);
      if (leadSearch.trim()) q = q.ilike("business_name", `%${leadSearch.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as { id: string; business_name: string }[];
    },
  });

  const addTask = useMutation({
    mutationFn: async (form: { title: string; due_date: string; lead_id: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("tasks").insert({
        user_id: userData.user!.id,
        lead_id: form.lead_id || null,
        type: "general_reminder",
        title: form.title.trim(),
        due_date: form.due_date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task added");
      setAdding(false);
      setAddForm({ title: "", due_date: today, lead_id: "" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["alert-count"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const completeTask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task completed");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["no-next-step"] });
      queryClient.invalidateQueries({ queryKey: ["alert-count"] });
      queryClient.invalidateQueries({ queryKey: ["notification-feed"] });
    },
  });

  const reschedule = useMutation({
    mutationFn: async ({ id, date }: { id: string; date: string }) => {
      const { error } = await supabase.from("tasks").update({ due_date: date }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task rescheduled");
      setRescheduling(null);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["alert-count"] });
      queryClient.invalidateQueries({ queryKey: ["notification-feed"] });
    },
  });

  const pending = (tasks ?? []).filter((t) => t.status === "pending");
  const views: Record<string, Task[]> = {
    today: pending.filter((t) => t.due_date === today),
    overdue: pending.filter((t) => t.due_date < today),
    upcoming: pending.filter((t) => t.due_date > today),
    completed: (tasks ?? []).filter((t) => t.status === "completed").slice(0, 100),
  };

  const taskTable = (list: Task[], showComplete = true) => {
    if (!list.length)
      return <p className="py-8 text-center text-sm text-muted-foreground">Nothing here. 🎉</p>;
    return (
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Lead</TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.title}</TableCell>
              <TableCell>
                {t.leads ? (
                  <Link href={`/leads/${t.leads.id}`} className="hover:underline">
                    {t.leads.business_name}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {t.campaigns?.name ?? "—"}
              </TableCell>
              <TableCell>
                <Badge className={toneClass(dueTone(t.due_date, today, t.status === "completed"))}>
                  {t.due_date}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge className={priorityClass(t.priority)}>
                  {t.priority}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {showComplete && (
                  <div className="flex justify-end gap-2">
                    <AddToCalendar
                      variant="ghost"
                      label=""
                      event={{
                        title: t.leads ? `${t.title} — ${t.leads.business_name}` : t.title,
                        description: "ORMS task",
                        start: new Date(`${t.due_date}T09:00:00`),
                        allDay: false,
                      }}
                      fileName={`task-${t.id}.ics`}
                    />
                    {rescheduling === t.id ? (
                      <>
                        <Input
                          type="date"
                          className="h-8 w-36"
                          value={newDate}
                          onChange={(e) => setNewDate(e.target.value)}
                        />
                        <Button
                          size="sm"
                          onClick={() => newDate && reschedule.mutate({ id: t.id, date: newDate })}
                        >
                          Save
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => { setRescheduling(t.id); setNewDate(t.due_date); }}>
                          Reschedule
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => completeTask.mutate(t.id)}>
                          Done
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add task
          </Button>
        )}
      </div>

      {adding && (
        <div className="space-y-3 rounded-md border p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="What to do…"
              value={addForm.title}
              onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
            />
            <Input
              type="date"
              value={addForm.due_date}
              onChange={(e) => setAddForm({ ...addForm, due_date: e.target.value })}
            />
            <Select
              value={addForm.lead_id || "none"}
              onValueChange={(v) => setAddForm({ ...addForm, lead_id: v === "none" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Link a lead (optional)" /></SelectTrigger>
              <SelectContent>
                <div className="p-1">
                  <Input
                    placeholder="Search lead…"
                    className="h-8"
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                  />
                </div>
                <SelectItem value="none">No lead</SelectItem>
                {leadOptions?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.business_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              disabled={addTask.isPending || !addForm.title.trim() || !addForm.due_date}
              onClick={() => addTask.mutate(addForm)}
            >
              {addTask.isPending ? "Adding…" : "Add task"}
            </Button>
          </div>
        </div>
      )}

      <Tabs defaultValue="today">
        <div className="overflow-x-auto pb-1">
        <TabsList>
          <TabsTrigger value="today">Due Today ({views.today.length})</TabsTrigger>
          <TabsTrigger value="overdue" className={views.overdue.length ? "text-destructive" : ""}>
            Overdue ({views.overdue.length})
          </TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({views.upcoming.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="nonext" className={noNextStep?.length ? "text-destructive" : ""}>
            No Next Step ({noNextStep?.length ?? 0})
          </TabsTrigger>
        </TabsList>
        </div>
        <TabsContent value="today">{taskTable(views.today)}</TabsContent>
        <TabsContent value="overdue">{taskTable(views.overdue)}</TabsContent>
        <TabsContent value="upcoming">{taskTable(views.upcoming)}</TabsContent>
        <TabsContent value="completed">{taskTable(views.completed, false)}</TabsContent>
        <TabsContent value="nonext">
          {!noNextStep?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Every contacted lead has a next step. 🎉
            </p>
          ) : (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                These leads have outreach history but no pending task — they are operationally lost.
                Open each and set a next action.
              </p>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Business</TableHead>
                    <TableHead>Website</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noNextStep.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.business_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.website ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/leads/${l.id}`}>Set Next Action</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
