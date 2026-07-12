import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { subDays } from "date-fns";
import { DailyTracker } from "@/components/daily-tracker";

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const startOfDay = `${today}T00:00:00Z`;
  const trackerSince = subDays(new Date(), 14).toISOString();

  const [
    leads, campaigns, dueToday, overdue, noNextStep, todayActivities, settingsRes,
    trackerActivities,
  ] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }),
    supabase
      .from("campaigns")
      .select("id, name, campaign_leads(status)")
      .eq("is_archived", false)
      .limit(6),
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "pending").eq("due_date", today),
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "pending").lt("due_date", today),
    supabase.from("no_next_step_leads").select("id", { count: "exact", head: true }),
    supabase.from("activities").select("type").gte("occurred_at", startOfDay),
    supabase.from("settings").select("*").maybeSingle(),
    supabase
      .from("activities")
      .select("type, occurred_at")
      .gte("occurred_at", trackerSince)
      .limit(10000),
  ]);

  const acts = todayActivities.data ?? [];
  const countType = (...types: string[]) => acts.filter((a) => types.includes(a.type)).length;
  const sentToday = countType("EMAIL_SENT", "FOLLOWUP_SENT");
  const repliesToday = countType("EMAIL_REPLY");
  const meetingsToday = countType("MEETING_BOOKED");
  const callsToday = countType("CALL_ATTEMPTED", "CALL_CONNECTED");

  const settings = settingsRes.data;
  const windowStr = settings
    ? `${settings.outreach_start_time.slice(0, 5)}–${settings.outreach_end_time.slice(0, 5)} (${settings.timezone})`
    : "10:00–12:00 (default)";
  const batchLogged = sentToday > 0;

  const outreachStats = [
    { label: "Emails Sent Today", value: sentToday },
    { label: "Replies Today", value: repliesToday },
    { label: "Meetings Booked", value: meetingsToday },
    { label: "Calls Made", value: callsToday },
  ];

  const opsStats = [
    {
      label: "Total Leads", value: leads.count ?? 0, href: "/leads",
      hint: "All leads in your warehouse. Click to open the leads table.",
    },
    {
      label: "Follow-ups Due Today", value: dueToday.count ?? 0, href: "/tasks",
      hint: "Pending tasks due today. Click to work through them.",
    },
    {
      label: "Overdue", value: overdue.count ?? 0, href: "/tasks",
      alert: (overdue.count ?? 0) > 0,
      hint: "Pending tasks past their due date — handle these first.",
    },
    {
      label: "No Next Step", value: noNextStep.count ?? 0, href: "/tasks",
      alert: (noNextStep.count ?? 0) > 0,
      hint: "Leads you've contacted that have no pending follow-up task — nothing will remind you about them. Open each and log an action or add a task.",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="text-sm font-medium">Today&apos;s Outreach Window</p>
            <p className="text-2xl font-bold">{windowStr}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={batchLogged ? "default" : "destructive"}>
              {batchLogged ? `Batch logged (${sentToday} sends)` : "Batch not logged yet"}
            </Badge>
            {!settings && (
              <Button asChild size="sm" variant="outline">
                <Link href="/settings">Configure</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">OUTREACH TODAY</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {outreachStats.map((s) => (
            <Card key={s.label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              </CardHeader>
              <CardContent><p className="text-3xl font-bold">{s.value}</p></CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">OPERATIONS</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {opsStats.map((s) => (
            <Link key={s.label} href={s.href} title={s.hint}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={`text-3xl font-bold ${s.alert ? "text-destructive" : ""}`}>{s.value}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          DAILY OUTREACH TRACKER — LAST 14 DAYS
        </h2>
        <Card>
          <CardContent className="pt-4">
            <DailyTracker
              activities={trackerActivities.data ?? []}
              emptyText="No outreach logged in the last 14 days — quick-log your first email from a lead page."
            />
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">ACTIVE CAMPAIGNS</h2>
        {!campaigns.data?.length ? (
          <p className="text-sm text-muted-foreground">
            No active campaigns. <Link href="/campaigns" className="underline">Create one</Link>.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns.data.map((c) => {
              const statuses = (c.campaign_leads ?? []) as { status: string }[];
              const total = statuses.length;
              const replied = statuses.filter((s) =>
                ["replied", "interested_meeting", "won"].includes(s.status)
              ).length;
              return (
                <Link key={c.id} href={`/campaigns/${c.id}`}>
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardHeader className="pb-1">
                      <CardTitle className="text-base">{c.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex gap-4 text-sm">
                      <span><strong>{total}</strong> leads</span>
                      <span><strong>{total ? Math.round((replied / total) * 100) : 0}%</strong> reply rate</span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
