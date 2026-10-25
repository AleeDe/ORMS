"use client";

import { useWorkspace, useWorkspaceClient } from "@/components/workspace-provider";

import { useEffect } from "react";
import Link from "@/components/workspace-link";
import { useQuery } from "@tanstack/react-query";
import { fetchNotificationFeed, markSeen } from "@/lib/notifications";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, AlertTriangle, Clock, CalendarClock } from "lucide-react";

const SEVERITY_ICONS = {
  critical: AlertTriangle,
  warn: AlertTriangle,
  info: Clock,
} as const;

export default function NotificationsPage() {
  const supabase = useWorkspaceClient();
  const { workspace, userId } = useWorkspace();

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("*").maybeSingle();
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["notification-feed"],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: () => fetchNotificationFeed(supabase),
  });

  // Viewing the page marks everything as seen → sidebar badge clears.
  useEffect(() => {
    if (items?.length) markSeen(items.map((i) => i.key), `${userId}:${workspace.id}`);
  }, [items, userId, workspace.id]);

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
          {items.map((n) => {
            const Icon = SEVERITY_ICONS[n.severity];
            return (
              <Link key={n.key} href={n.href} className="block">
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center gap-3 py-3">
                    <Icon className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      {n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}
                    </div>
                    <Badge variant={badgeVariant[n.severity]}>{n.severity}</Badge>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        These items stay listed until resolved (e.g. set a next task for a &ldquo;no next step&rdquo;
        lead). The sidebar badge only counts ones you haven&rsquo;t viewed yet.
      </p>
    </div>
  );
}
