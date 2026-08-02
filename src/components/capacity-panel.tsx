"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  getCapacity, getForecast, deferFollowupsToday, splitRemaining,
  explainCap, warmupSchedule, fullSpeedDate,
} from "@/lib/capacity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, TrendingUp, PauseCircle, ChevronDown, ChevronUp } from "lucide-react";
import { toneClass } from "@/lib/badge-styles";

// "What can I send today?" — the panel that stops the user flying blind as
// follow-ups compound and quietly eat the whole daily budget.
export function CapacityPanel() {
  const supabase = createClient();
  const qc = useQueryClient();
  const [showForecast, setShowForecast] = useState(false);

  const { data: cap } = useQuery({
    queryKey: ["sending-capacity"],
    queryFn: () => getCapacity(supabase),
    refetchOnWindowFocus: true,
  });

  const { data: forecast } = useQuery({
    queryKey: ["sending-forecast"],
    enabled: showForecast,
    queryFn: () => getForecast(supabase, 7),
  });

  const defer = useMutation({
    mutationFn: () => deferFollowupsToday(supabase),
    onSuccess: (n) => {
      toast.success(
        n > 0
          ? `${n} follow-up${n === 1 ? "" : "s"} moved to tomorrow — today is all new leads`
          : "No follow-ups were due today"
      );
      qc.invalidateQueries({ queryKey: ["sending-capacity"] });
      qc.invalidateQueries({ queryKey: ["email-queue"] });
      qc.invalidateQueries({ queryKey: ["sending-forecast"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!cap) return null;

  const split = splitRemaining(cap);
  const pct = cap.cap > 0 ? Math.min(100, (cap.used_today / cap.cap) * 100) : 0;
  const peak = (forecast ?? []).reduce(
    (m, d) => (d.followups > m.followups ? d : m),
    { day: "", followups: 0, new_leads: 0, total: 0 }
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {cap.used_today} / {cap.cap}
            </span>
            <span className="text-sm text-muted-foreground">sent today</span>
          </div>
          <span className="text-sm text-muted-foreground">
            <strong className="text-foreground tabular-nums">{cap.remaining}</strong> left
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="text-xs text-muted-foreground">{explainCap(cap)}</p>

        {/* The split — follow-ups are served first, so this is what actually
            determines how many new leads can go out. */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">Follow-ups due</p>
            <p className="text-lg font-medium tabular-nums">{cap.followups_due}</p>
            <p className="text-xs text-muted-foreground">sent first</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">New leads possible</p>
            <p className="text-lg font-medium tabular-nums">{split.newSlots}</p>
            <p className="text-xs text-muted-foreground">
              {cap.new_due} waiting
            </p>
          </div>
        </div>

        {split.followupsBlockNew && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                Follow-ups fill today&apos;s budget, so no new leads will go out.
                This is normal once a sequence is running — but if reaching new
                leads matters more today, push the follow-ups to tomorrow.
              </p>
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={defer.isPending}
                onClick={() => defer.mutate()}
              >
                <PauseCircle className="h-3.5 w-3.5 mr-1" />
                Move today&apos;s follow-ups to tomorrow
              </Button>
            </div>
          </div>
        )}

        {cap.warmup_active && (
          <div className="rounded-md border p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-medium">
                Warming up — week {cap.warmup_week} of 5
              </span>
            </div>
            <div className="flex gap-1">
              {warmupSchedule(cap.warmup_week).map((w) => (
                <div
                  key={w.week}
                  className={`flex-1 rounded px-1 py-0.5 text-center text-[10px] ${
                    w.state === "current"
                      ? toneClass("blue")
                      : w.state === "done"
                        ? toneClass("green")
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  wk{w.week}
                  <br />
                  {w.limit}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Full speed from{" "}
              <strong>
                {fullSpeedDate(cap.warmup_weeks_left).toLocaleDateString(undefined, {
                  day: "numeric", month: "long",
                })}
              </strong>
              . New domains that send too fast get filtered as spam.
            </p>
          </div>
        )}

        {cap.monthly_limit != null && (
          <p className="text-xs text-muted-foreground">
            This month: {cap.used_month} / {cap.monthly_limit}
            {cap.used_month / cap.monthly_limit > 0.8 && (
              <Badge className={`ml-2 ${toneClass("amber")}`}>running low</Badge>
            )}
          </p>
        )}

        <div>
          <Button
            size="sm" variant="ghost" className="h-7 -ml-2"
            onClick={() => setShowForecast(!showForecast)}
          >
            {showForecast ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            Next 7 days
          </Button>

          {showForecast && forecast && (
            <div className="mt-2 space-y-1">
              {forecast.map((d) => {
                const over = d.total > cap.cap;
                return (
                  <div key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-muted-foreground">
                      {new Date(d.day).toLocaleDateString(undefined, {
                        weekday: "short", day: "numeric", month: "short",
                      })}
                    </span>
                    <div className="flex h-4 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="bg-amber-500/70"
                        style={{ width: `${Math.min(100, (d.followups / Math.max(cap.cap, 1)) * 100)}%` }}
                        title={`${d.followups} follow-ups`}
                      />
                      <div
                        className="bg-primary/70"
                        style={{ width: `${Math.min(100, (d.new_leads / Math.max(cap.cap, 1)) * 100)}%` }}
                        title={`${d.new_leads} new`}
                      />
                    </div>
                    <span className={`w-16 shrink-0 text-right tabular-nums ${over ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                      {d.total}{over ? " over" : ""}
                    </span>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-sm bg-amber-500/70" /> follow-ups
                {"  "}
                <span className="inline-block h-2 w-2 rounded-sm bg-primary/70" /> new leads
                {peak.followups > 0 && (
                  <>
                    {" "}— busiest day{" "}
                    {new Date(peak.day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    {" "}with {peak.followups} follow-ups.
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
