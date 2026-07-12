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
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

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
              <TableCell className={t.due_date < today && t.status === "pending" ? "text-destructive" : ""}>
                {t.due_date}
              </TableCell>
              <TableCell>
                <Badge variant={t.priority === "high" ? "destructive" : "secondary"}>
                  {t.priority}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {showComplete && (
                  <div className="flex justify-end gap-2">
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
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
      <Tabs defaultValue="today">
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
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
