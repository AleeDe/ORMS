import { SupabaseClient } from "@supabase/supabase-js";
import { todayStr } from "./dates";
import { fetchMissingNextSteps, leadHref } from "./campaign-scope";

export type FeedItem = {
  key: string;
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
  href: string;
};

export async function fetchNotificationFeed(supabase: SupabaseClient): Promise<FeedItem[]> {
  const today = todayStr();
  const [due, overdue, noNext] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, campaign_id, campaigns!tasks_campaign_id_fkey(name), leads!tasks_lead_id_fkey(id, business_name)")
      .eq("status", "pending").eq("due_date", today).limit(50),
    supabase
      .from("tasks")
      .select("id, title, due_date, campaign_id, campaigns!tasks_campaign_id_fkey(name), leads!tasks_lead_id_fkey(id, business_name)")
      .eq("status", "pending").lt("due_date", today).limit(50),
    fetchMissingNextSteps(supabase),
  ]);

  const list: FeedItem[] = [];
  type TaskRow = { id: string; title: string; due_date: string; campaign_id: string | null; campaigns: { name: string } | null; leads: { id: string; business_name: string } | null };
  for (const t of (overdue.data ?? []) as unknown as TaskRow[]) {
    list.push({
      key: `od-${t.id}`, severity: "critical",
      title: `Overdue: ${t.title}`,
      body: `${t.leads?.business_name ?? "Task"}${t.campaigns ? ` · ${t.campaigns.name}` : ""} — was due ${t.due_date}`,
      href: t.leads ? leadHref(t.leads.id, t.campaign_id) : "/tasks",
    });
  }
  for (const l of noNext.slice(0, 50)) {
    list.push({
      key: `nn-${l.id}-${l.campaign_id ?? "library"}`, severity: "warn",
      title: "No next step",
      body: `${l.business_name}${l.campaign_name ? ` · ${l.campaign_name}` : ""} has outreach history but no pending task`,
      href: leadHref(l.id, l.campaign_id),
    });
  }
  for (const t of (due.data ?? []) as unknown as TaskRow[]) {
    list.push({
      key: `due-${t.id}`, severity: "info",
      title: `Due today: ${t.title}`,
      body: `${t.leads?.business_name ?? ""}${t.campaigns ? ` · ${t.campaigns.name}` : ""}`,
      href: t.leads ? leadHref(t.leads.id, t.campaign_id) : "/tasks",
    });
  }
  return list;
}

// "Seen" store: keys the user has already viewed on the Notifications page.
// Backed by localStorage; useSyncExternalStore-compatible so the sidebar badge
// clears immediately when the page is opened.
const SEEN_KEY = "orms-notifications-seen";
const listeners = new Set<() => void>();

export function subscribeSeen(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getSeenRaw(scope: string): string {
  return localStorage.getItem(`${SEEN_KEY}:${scope}`) ?? "[]";
}

export function getSeenRawServer(): string {
  return "[]";
}

export function markSeen(keys: string[], scope: string) {
  const seen = new Set<string>(JSON.parse(getSeenRaw(scope)));
  let changed = false;
  for (const k of keys) {
    if (!seen.has(k)) {
      seen.add(k);
      changed = true;
    }
  }
  if (!changed) return;
  // cap so stale keys don't grow forever
  localStorage.setItem(`${SEEN_KEY}:${scope}`, JSON.stringify([...seen].slice(-500)));
  listeners.forEach((cb) => cb());
}
