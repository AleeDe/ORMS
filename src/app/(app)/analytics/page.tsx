"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/quick-log";
import {
  SEND_TYPES, REPLY_TYPES, MEETING_TYPES, CALL_TYPES, trackerTotals, buildTrackerRows,
  buildCallDays, callTotals,
} from "@/lib/tracker";
import { DailyTracker } from "@/components/daily-tracker";
import { Badge } from "@/components/ui/badge";
import { toneClass } from "@/lib/badge-styles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SequenceAnalytics } from "@/components/sequence-analytics";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, ReferenceArea,
} from "recharts";
import { format, subDays } from "date-fns";

const C_SENDS = "#2a78d6"; // blue — categorical slot 1
const C_REPLIES = "#1baf7a"; // aqua — slot 2

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export default function AnalyticsPage() {
  const supabase = createClient();
  const [rangeDays, setRangeDays] = useState("30");
  const [campaignFilter, setCampaignFilter] = useState("all");

  const days = parseInt(rangeDays);
  const since = useMemo(
    () => subDays(new Date(), days).toISOString(),
    [days]
  );

  const { data: activities } = useQuery({
    queryKey: ["analytics-activities", rangeDays, campaignFilter],
    queryFn: async () => {
      let q = supabase
        .from("activities")
        .select("type, occurred_at, campaign_id")
        .gte("occurred_at", since)
        .limit(10000);
      if (campaignFilter !== "all") q = q.eq("campaign_id", campaignFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const { data: campaigns } = useQuery({
    queryKey: ["analytics-campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, campaign_leads(status, touch_count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("*").maybeSingle();
      return data;
    },
  });

  const visibleCampaigns = useMemo(
    () =>
      campaignFilter === "all"
        ? campaigns ?? []
        : (campaigns ?? []).filter((c) => c.id === campaignFilter),
    [campaigns, campaignFilter]
  );

  const daily = useMemo(() => {
    const out: { day: string; label: string; Sends: number; Replies: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = subDays(new Date(), i);
      out.push({ day: format(d, "yyyy-MM-dd"), label: format(d, "d MMM"), Sends: 0, Replies: 0 });
    }
    const byDay = new Map(out.map((d) => [d.day, d]));
    for (const a of activities ?? []) {
      const row = byDay.get(a.occurred_at.slice(0, 10));
      if (!row) continue;
      if (SEND_TYPES.includes(a.type)) row.Sends++;
      if (REPLY_TYPES.includes(a.type)) row.Replies++;
    }
    return out;
  }, [activities, days]);

  const hourly = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      Sends: 0,
    }));
    for (const a of activities ?? []) {
      if (SEND_TYPES.includes(a.type)) hours[new Date(a.occurred_at).getHours()].Sends++;
    }
    return hours;
  }, [activities]);

  const weekday = useMemo(() => {
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const out = names.map((label) => ({ label, Sends: 0, Replies: 0 }));
    for (const a of activities ?? []) {
      const idx = (new Date(a.occurred_at).getDay() + 6) % 7; // Mon=0
      if (SEND_TYPES.includes(a.type)) out[idx].Sends++;
      if (REPLY_TYPES.includes(a.type)) out[idx].Replies++;
    }
    return out;
  }, [activities]);

  // Activity-based totals for the filtered period (drives the KPI tiles)
  const totals = useMemo(
    () => trackerTotals(buildTrackerRows(activities ?? [])),
    [activities]
  );
  const meetingsBooked = (activities ?? []).filter((a) => MEETING_TYPES.includes(a.type)).length;
  const callsMade = (activities ?? []).filter((a) => CALL_TYPES.includes(a.type)).length;
  const activeDays = useMemo(
    () => buildTrackerRows(activities ?? []).filter((r) => r.sends > 0).length,
    [activities]
  );

  // Pipeline (status) breakdown across the filtered campaigns
  const pipeline = useMemo(() => {
    const all = visibleCampaigns.flatMap(
      (c) => (c.campaign_leads ?? []) as { status: string; touch_count: number }[]
    );
    const counts: Record<string, number> = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
    for (const l of all) counts[l.status] = (counts[l.status] ?? 0) + 1;
    const contacted = all.filter((l) => l.status !== "new");
    const replied = all.filter((l) =>
      ["replied", "interested_meeting", "won"].includes(l.status)
    );
    const positive = all.filter((l) => ["interested_meeting", "won"].includes(l.status));
    const totalTouches = all.reduce((s, l) => s + l.touch_count, 0);
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
    return {
      counts,
      total: all.length,
      leadReplyRate: pct(replied.length, contacted.length),
      positiveRate: pct(positive.length, contacted.length),
      touchToReply: replied.length ? (totalTouches / replied.length).toFixed(1) : "—",
    };
  }, [visibleCampaigns]);

  // Call performance: per-day dials/connects and auto-generated insights.
  const callDays = useMemo(() => buildCallDays(activities ?? []), [activities]);
  const call = useMemo(() => callTotals(callDays), [callDays]);
  const bestCallDay = useMemo(
    () => [...callDays].filter((d) => d.dialed >= 5).sort((a, b) => b.connectRate - a.connectRate)[0],
    [callDays]
  );
  const callInsights = useMemo(() => {
    const out: { tone: "green" | "amber" | "red" | "blue"; title: string; body: string }[] = [];
    if (!call.dialed) return out;
    // connect rate vs benchmark (~25%)
    if (call.connectRate >= 40)
      out.push({ tone: "green", title: `Strong connect rate — ${call.connectRate}%`,
        body: `You reached ${call.connected} of ${call.dialed} numbers. That's well above the typical 20–30% cold-call benchmark — your timing and number quality are working.` });
    else if (call.connectRate > 0)
      out.push({ tone: "amber", title: `Connect rate is ${call.connectRate}%`,
        body: `${call.connected} of ${call.dialed} numbers answered. Below ~30% suggests trying different call windows or checking number quality.` });
    // conversion after connect
    if (call.connected >= 10 && call.meetingRate < 8)
      out.push({ tone: "amber", title: "The bottleneck is the conversation, not the reach",
        body: `You connect well but only ${call.meetings} meeting${call.meetings === 1 ? "" : "s"} from ${call.connected} conversations (${call.meetingRate}%). The leak is in the pitch — worth capturing what worked on your best calls.` });
    // no-answer follow-up opportunity
    if (call.noAnswer >= 10)
      out.push({ tone: "red", title: `${call.noAnswer} numbers went unanswered`,
        body: `At your ${call.connectRate}% connect rate, a single retry on those could add roughly ${Math.round(call.noAnswer * call.connectRate / 100)} more conversations — for zero new list. Queue them as callback tasks.` });
    // best day
    if (bestCallDay)
      out.push({ tone: "blue", title: `${bestCallDay.weekday} is your strongest calling day`,
        body: `${bestCallDay.dateLabel} hit a ${bestCallDay.connectRate}% connect rate on ${bestCallDay.dialed} dials. Concentrate high-value calls when you answer best.` });
    return out;
  }, [call, bestCallDay]);

  const connectPct = (r: { connectRate: number }) =>
    r.connectRate >= 50 ? "green" : r.connectRate >= 30 ? "amber" : "red";

  const windowStart = settings ? parseInt(settings.outreach_start_time.slice(0, 2)) : 10;
  const windowEnd = settings ? parseInt(settings.outreach_end_time.slice(0, 2)) : 12;

  const tiles = [
    { label: `Emails Sent (${days}d)`, value: totals.sends },
    { label: "Replies Received", value: totals.replies },
    { label: "Email Reply Rate", value: `${totals.replyRate.toFixed(2)}%` },
    { label: "Meetings Booked", value: meetingsBooked },
    { label: "Calls Made", value: callsMade },
    { label: "Active Sending Days", value: activeDays },
    { label: "Lead Reply Rate", value: `${pipeline.leadReplyRate}%` },
    { label: "Avg Touches per Reply", value: pipeline.touchToReply },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={rangeDays} onValueChange={setRangeDays}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Campaign" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {(campaigns ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
            </CardHeader>
            <CardContent><p className="text-3xl font-bold">{t.value}</p></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Outreach Tracker</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyTracker
            activities={activities ?? []}
            emptyText="No outreach logged in this period for the selected filters."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Sends & Replies — last {days} days</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={daily} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                interval={Math.max(0, Math.floor(days / 8) - 1)}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "var(--muted)" }} />
              <Legend />
              <Bar dataKey="Sends" fill={C_SENDS} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Replies" fill={C_REPLIES} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Send Timing vs Outreach Window ({String(windowStart).padStart(2, "0")}:00–
              {String(windowEnd).padStart(2, "0")}:00)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "var(--muted)" }} />
                <ReferenceArea
                  x1={`${String(windowStart).padStart(2, "0")}:00`}
                  x2={`${String(windowEnd).padStart(2, "0")}:00`}
                  fill={C_REPLIES}
                  fillOpacity={0.12}
                  label={{ value: "window", position: "insideTop", fontSize: 11 }}
                />
                <Bar dataKey="Sends" fill={C_SENDS} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="pt-2 text-xs text-muted-foreground">
              Shaded band = your configured outreach window. Bars outside it are sends logged off-window.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Best Day of Week</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weekday} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "var(--muted)" }} />
                <Legend />
                <Bar dataKey="Sends" fill={C_SENDS} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Replies" fill={C_REPLIES} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="pt-2 text-xs text-muted-foreground">
              Which weekdays get you the most replies for the sends you make.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pipeline Breakdown{campaignFilter !== "all" ? " — filtered campaign" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</p>
                <p className="text-xl font-bold">{pipeline.counts[s] ?? 0}</p>
                <p className="text-xs text-muted-foreground">
                  {pipeline.total ? Math.round(((pipeline.counts[s] ?? 0) / pipeline.total) * 100) : 0}% of {pipeline.total}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ---- Call performance ---- */}
      {call.dialed > 0 && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <h2 className="text-lg font-semibold tracking-tight">Call Performance</h2>
            <span className="text-sm text-muted-foreground">
              — {call.activeDays} active day{call.activeDays === 1 ? "" : "s"} in this period
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Numbers dialed", value: call.dialed, note: `${call.activeDays} active days` },
              { label: "Answered", value: call.connected, note: `${call.connectRate}% connect rate`, tone: "green" as const },
              { label: "No answer", value: call.noAnswer, note: `${call.dialed ? Math.round(call.noAnswer / call.dialed * 100) : 0}% of dials` },
              { label: "Meetings from calls", value: call.meetings, note: `${call.meetingRate}% of answered` },
            ].map((t) => (
              <Card key={t.label}>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={`text-3xl font-bold ${t.tone === "green" ? "text-green-600" : ""}`}>{t.value}</p>
                  <p className="pt-1 text-xs text-muted-foreground">{t.note}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Daily Call Log</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Dialed</TableHead>
                    <TableHead className="text-right">Connected</TableHead>
                    <TableHead className="text-right">Connect rate</TableHead>
                    <TableHead className="text-right">Meetings</TableHead>
                    <TableHead className="text-right">Replies</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {callDays.map((r) => (
                    <TableRow key={r.day}>
                      <TableCell className="font-medium">{r.dateLabel}</TableCell>
                      <TableCell className="text-muted-foreground">{r.weekday}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.dialed}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.connected}</TableCell>
                      <TableCell className="text-right">
                        <Badge className={toneClass(connectPct(r))}>{r.connectRate}%</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.meetings}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.replies}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-muted-foreground">{call.activeDays} days</TableCell>
                    <TableCell className="text-right tabular-nums">{call.dialed}</TableCell>
                    <TableCell className="text-right tabular-nums">{call.connected}</TableCell>
                    <TableCell className="text-right">
                      <Badge className={toneClass(connectPct(call))}>{call.connectRate}%</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{call.meetings}</TableCell>
                    <TableCell className="text-right tabular-nums">{call.replies}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Call Funnel</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  { stage: "Numbers dialed", n: call.dialed, ofDials: 100 },
                  { stage: "Answered", n: call.connected, ofDials: call.connectRate },
                  { stage: "Meetings booked", n: call.meetings, ofDials: call.dialed ? Math.round(call.meetings / call.dialed * 1000) / 10 : 0 },
                ].map((s) => (
                  <div key={s.stage} className="space-y-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{s.stage}</span>
                      <span className="tabular-nums text-muted-foreground">{s.n} · {s.ofDials}% of dials</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded bg-muted">
                      <div className="h-full rounded bg-primary" style={{ width: `${Math.max(2, s.ofDials)}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">What the numbers say</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {!callInsights.length && (
                  <p className="text-sm text-muted-foreground">Log a few more calls to unlock insights.</p>
                )}
                {callInsights.map((ins) => (
                  <div
                    key={ins.title}
                    className={`rounded-md border border-l-[3px] p-3 ${
                      ins.tone === "green" ? "border-l-green-500"
                      : ins.tone === "amber" ? "border-l-amber-500"
                      : ins.tone === "red" ? "border-l-red-500"
                      : "border-l-blue-500"
                    }`}
                  >
                    <p className="text-sm font-semibold">{ins.title}</p>
                    <p className="text-sm text-muted-foreground">{ins.body}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Campaign Performance</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Contacted</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="text-right">Reply Rate</TableHead>
                <TableHead className="text-right">Meetings</TableHead>
                <TableHead className="text-right">Won</TableHead>
                <TableHead className="text-right">Lost / No Fit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!visibleCampaigns.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No campaigns yet.
                  </TableCell>
                </TableRow>
              ) : (
                visibleCampaigns.map((c) => {
                  const ls = (c.campaign_leads ?? []) as { status: string }[];
                  const contacted = ls.filter((l) => l.status !== "new").length;
                  const replied = ls.filter((l) =>
                    ["replied", "interested_meeting", "won"].includes(l.status)
                  ).length;
                  const meetings = ls.filter((l) =>
                    ["interested_meeting", "won"].includes(l.status)
                  ).length;
                  const won = ls.filter((l) => l.status === "won").length;
                  const dead = ls.filter((l) => ["lost", "no_fit"].includes(l.status)).length;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-right">{ls.length}</TableCell>
                      <TableCell className="text-right">{contacted}</TableCell>
                      <TableCell className="text-right">{replied}</TableCell>
                      <TableCell className="text-right">
                        {contacted ? Math.round((replied / contacted) * 100) : 0}%
                      </TableCell>
                      <TableCell className="text-right">{meetings}</TableCell>
                      <TableCell className="text-right">{won}</TableCell>
                      <TableCell className="text-right">{dead}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="pt-2">
        <h2 className="text-lg font-semibold tracking-tight">Email sequences</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Which steps earn replies, and when to send.
        </p>
        <SequenceAnalytics />
      </div>
    </div>
  );
}
