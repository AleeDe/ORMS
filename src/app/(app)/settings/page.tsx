"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const TIMEZONES = [
  "Europe/London", "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane",
  "Australia/Perth", "Asia/Karachi", "UTC",
];

const DEFAULTS = {
  outreach_start_time: "10:00",
  outreach_end_time: "12:00",
  timezone: "Europe/London",
  schedule_in_window: true,
  daily_email_target: null as number | null,
  default_followup_days: 3,
  notify_followups: true,
  notify_overdue: true,
  notify_no_next_step: true,
  notify_outreach_window: true,
};

type SettingsForm = typeof DEFAULTS;

export default function SettingsPage() {
  const supabase = createClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("*").maybeSingle();
      return data;
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const initial: SettingsForm = settings
    ? {
        outreach_start_time: settings.outreach_start_time.slice(0, 5),
        outreach_end_time: settings.outreach_end_time.slice(0, 5),
        timezone: settings.timezone,
        schedule_in_window: settings.schedule_in_window ?? true,
        daily_email_target: settings.daily_email_target ?? null,
        default_followup_days: settings.default_followup_days,
        notify_followups: settings.notify_followups,
        notify_overdue: settings.notify_overdue,
        notify_no_next_step: settings.notify_no_next_step,
        notify_outreach_window: settings.notify_outreach_window,
      }
    : DEFAULTS;

  return <SettingsEditor initial={initial} />;
}

function SettingsEditor({ initial }: { initial: SettingsForm }) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);

  const save = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("settings")
        .upsert({ user_id: userData.user!.id, ...form });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outreach Window</CardTitle>
          <CardDescription>
            Your daily send window. Drives the dashboard widget, batch reminders, and timing analytics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="space-y-2">
              <Label>Start time</Label>
              <Input
                type="time"
                value={form.outreach_start_time}
                onChange={(e) => setForm({ ...form, outreach_start_time: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>End time</Label>
              <Input
                type="time"
                value={form.outreach_end_time}
                onChange={(e) => setForm({ ...form, outreach_end_time: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select
                value={form.timezone}
                onValueChange={(v) => setForm({ ...form, timezone: v })}
              >
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between gap-4">
              <Label>Deliver sequence emails inside this window</Label>
              <Switch
                checked={form.schedule_in_window}
                onCheckedChange={(v) => setForm({ ...form, schedule_in_window: v })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              On: review whenever suits you, and approved emails are held until the window —
              spread across it rather than sent in one burst. Off: they go the moment you click
              Send.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Daily email target (optional)</Label>
            <Input
              type="number" min={1} className="w-32"
              placeholder="auto"
              value={form.daily_email_target ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  daily_email_target: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to let ORMS decide from your warm-up week and provider limit. Setting a
              value only ever lowers the cap — it cannot exceed what your provider allows or what
              warm-up currently permits.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Follow-ups</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Label htmlFor="fu-days">Default follow-up interval (business days)</Label>
            <Input
              id="fu-days"
              type="number"
              min={1}
              max={30}
              className="w-20"
              value={form.default_followup_days}
              onChange={(e) =>
                setForm({ ...form, default_followup_days: parseInt(e.target.value) || 3 })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription>In-app notifications (push arrives with the mobile companion).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(
            [
              ["notify_followups", "Follow-up reminders"],
              ["notify_overdue", "Overdue warnings"],
              ["notify_no_next_step", "No-next-step warnings"],
              ["notify_outreach_window", "Outreach window reminder"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between">
              <Label>{label}</Label>
              <Switch
                checked={form[key]}
                onCheckedChange={(v) => setForm({ ...form, [key]: v })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <GoogleCalendarCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email &amp; Sequences</CardTitle>
          <CardDescription>
            Sending domains, sender addresses, and email sequences.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link href="/settings/email">Manage email settings</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>Change the password you sign in with.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link href="/login/update-password">Change password</Link>
          </Button>
        </CardContent>
      </Card>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        Save Settings
      </Button>
    </div>
  );
}

function GoogleCalendarCard() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const params = useSearchParams();

  // Surface the callback result once.
  useEffect(() => {
    const status = params.get("calendar");
    if (status === "connected") toast.success("Google Calendar connected");
    if (status === "error") toast.error("Couldn't connect Google Calendar");
    if (status) {
      queryClient.invalidateQueries({ queryKey: ["gcal-connection"] });
      window.history.replaceState(null, "", "/settings");
    }
  }, [params, queryClient]);

  const { data: conn, isLoading } = useQuery({
    queryKey: ["gcal-connection"],
    queryFn: async () => {
      const { data } = await supabase
        .from("google_calendar_tokens")
        .select("google_email, connected_at")
        .maybeSingle();
      return data;
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("google_calendar_tokens").delete().neq("user_id", "");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Google Calendar disconnected");
      queryClient.invalidateQueries({ queryKey: ["gcal-connection"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="h-4 w-4" /> Google Calendar
        </CardTitle>
        <CardDescription>
          Connect your Google Calendar and booked meetings &amp; new tasks are added to it
          automatically. Not connected? You still get an “Add to calendar” button on tasks.{" "}
          <a href="/help" className="text-primary hover:underline">Learn more</a>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : conn ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              Connected{conn.google_email ? ` as ${conn.google_email}` : ""}.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <Button asChild>
            <a href="/api/google/connect">Connect Google Calendar</a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
