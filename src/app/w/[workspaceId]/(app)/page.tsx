import Link from "@/components/workspace-link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { subDays } from "date-fns";
import { DailyTracker } from "@/components/daily-tracker";
import { fetchMissingNextSteps } from "@/lib/campaign-scope";
import { ArrowUpRight, Upload, MessagesSquare, PhoneCall, CalendarCheck, Send, Sparkles } from "lucide-react";

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
      .select("id, name, campaign_leads!campaign_leads_campaign_id_fkey(status)")
      .eq("is_archived", false)
      .limit(6),
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "pending").eq("due_date", today),
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "pending").lt("due_date", today),
    fetchMissingNextSteps(supabase),
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
    { label: "Emails sent", value: sentToday, icon: Send, color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" },
    { label: "Replies received", value: repliesToday, icon: MessagesSquare, color: "bg-teal-500/10 text-teal-700 dark:text-teal-300" },
    { label: "Meetings booked", value: meetingsToday, icon: CalendarCheck, color: "bg-violet-500/10 text-violet-600 dark:text-violet-300" },
    { label: "Calls made", value: callsToday, icon: PhoneCall, color: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
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
      label: "No Next Step", value: noNextStep.length, href: "/tasks",
      alert: noNextStep.length > 0,
      hint: "Leads you've contacted that have no pending follow-up task — nothing will remind you about them. Open each and log an action or add a task.",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-6 text-white shadow-lg md:p-9">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full bg-teal-400/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div><p className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200"><Sparkles className="size-4 text-teal-300" /> Your outreach, in motion</p><h1 className="max-w-xl text-3xl font-bold tracking-tight md:text-4xl">Make your next<br className="hidden sm:block" /> connection count.</h1><p className="mt-4 max-w-md text-sm leading-relaxed text-indigo-100/75">From a fresh dataset to a real conversation. Bring your audience together, then give every campaign its own momentum.</p></div>
          <div className="flex flex-wrap gap-3"><Button asChild className="bg-white text-indigo-950 hover:bg-indigo-50"><Link href="/campaigns">Open campaigns <ArrowUpRight className="ml-2 size-4" /></Link></Button><Button asChild variant="outline" className="border-white/25 bg-white/5 text-white hover:bg-white/15 hover:text-white"><Link href="/datasets/import"><Upload className="mr-2 size-4" /> Import data</Link></Button></div>
        </div>
        <div className="relative mt-7 grid grid-cols-3 gap-3 border-t border-white/15 pt-5">{[{ label: "Import your data", href: "/datasets" }, { label: "Find your audience", href: "/leads" }, { label: "Start a conversation", href: "/campaigns" }].map((step, index) => <Link key={step.href} href={step.href} className="group text-xs text-indigo-100/70 hover:text-white sm:text-sm"><span className="mr-2 font-mono text-teal-300">0{index + 1}</span>{step.label}<ArrowUpRight className="ml-1 hidden size-3 group-hover:inline" /></Link>)}</div>
      </section>

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
                <div className="flex items-center justify-between gap-2"><CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle><span className={`flex size-9 items-center justify-center rounded-xl ${s.color}`}><s.icon className="size-4" /></span></div>
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
