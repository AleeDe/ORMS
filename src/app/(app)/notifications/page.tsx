"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { todayStr } from "@/lib/dates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, AlertTriangle, Clock, CalendarClock } from "lucide-react";

type Item = {
  key: string;
  icon: React.ElementType;
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
  href: string;
};

export default function NotificationsPage() {
  const supabase = createClient();
  const today = todayStr();

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("*").maybeSingle();
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["notification-feed"],
    queryFn: async () => {
      const [due, overdue, noNext] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, title, due_date, leads(id, business_name)")
          .eq("status", "pending").eq("due_date", today).limit(50),
        supabase
          .from("tasks")
          .select("id, title, due_date, leads(id, business_name)")
          .eq("status", "pending").lt("due_date", today).limit(50),
        supabase.from("no_next_step_leads").select("id, business_name").limit(50),
      ]);

      const list: Item[] = [];
      type TaskRow = { id: string; title: string; due_date: string; leads: { id: string; business_name: string } | null };
      for (const t of (overdue.data ?? []) as unknown as TaskRow[]) {
        list.push({
          key: `od-${t.id}`, icon: AlertTriangle, severity: "critical",
          title: `Overdue: ${t.title}`,
          body: `${t.leads?.business_name ?? "Lead"} — was due ${t.due_date}`,
          href: t.leads ? `/leads/${t.leads.id}` : "/tasks",
        });
      }
      for (const l of noNext.data ?? []) {
        list.push({
          key: `nn-${l.id}`, icon: AlertTriangle, severity: "warn",
          title: "No next step",
          body: `${l.business_name} has outreach history but no pending task`,
          href: `/leads/${l.id}`,
        });
      }
      for (const t of (due.data ?? []) as unknown as TaskRow[]) {
        list.push({
          key: `due-${t.id}`, icon: Clock, severity: "info",
          title: `Due today: ${t.title}`,
          body: t.leads?.business_name ?? "",
          href: t.leads ? `/leads/${t.leads.id}` : "/tasks",
        });
      }
      return list;
    },
  });

  // outreach window reminder (client-side, in-app)
  const windowReminder = (() => {
    if (!settings?.notify_outreach_window) return null;
    const now = new Date();
    const [sh, sm] = settings.outreach_start_time.split(":").map(Number);
    const [eh, em] = settings.outreach_end_time.split(":").map(Number);
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins >= sh * 60 + sm && mins <= eh * 60 + em) {
      return `You're inside your outreach window (${settings.outreach_start_time.slice(0, 5)}–${settings.outreach_end_time.slice(0, 5)}) — send your batch now.`;
    }
    return null;
  })();

  const badgeVariant = { critical: "destructive", warn: "default", info: "secondary" } as const;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>

      {windowReminder && (
        <Card className="border-primary">
          <CardContent className="flex items-center gap-3 py-4">
            <CalendarClock className="h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">{windowReminder}</p>
          </CardContent>
        </Card>
      )}

      {!items?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Bell className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">All clear — nothing needs your attention.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Link key={n.key} href={n.href} className="block">
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center gap-3 py-3">
                  <n.icon className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    {n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}
                  </div>
                  <Badge variant={badgeVariant[n.severity]}>{n.severity}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Notifications are computed live from your tasks and leads. Push notifications arrive with the
        mobile companion app.
      </p>
    </div>
  );
}
