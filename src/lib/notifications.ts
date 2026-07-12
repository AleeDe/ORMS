import { SupabaseClient } from "@supabase/supabase-js";
import { todayStr } from "./dates";

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
      .select("id, title, due_date, leads(id, business_name)")
      .eq("status", "pending").eq("due_date", today).limit(50),
    supabase
      .from("tasks")
      .select("id, title, due_date, leads(id, business_name)")
      .eq("status", "pending").lt("due_date", today).limit(50),
    supabase.from("no_next_step_leads").select("id, business_name").limit(50),
  ]);

  const list: FeedItem[] = [];
  type TaskRow = { id: string; title: string; due_date: string; leads: { id: string; business_name: string } | null };
  for (const t of (overdue.data ?? []) as unknown as TaskRow[]) {
    list.push({
      key: `od-${t.id}`, severity: "critical",
      title: `Overdue: ${t.title}`,
      body: `${t.leads?.business_name ?? "Lead"} — was due ${t.due_date}`,
      href: t.leads ? `/leads/${t.leads.id}` : "/tasks",
    });
  }
  for (const l of noNext.data ?? []) {
    list.push({
      key: `nn-${l.id}`, severity: "warn",
      title: "No next step",
      body: `${l.business_name} has outreach history but no pending task`,
      href: `/leads/${l.id}`,
    });
  }
  for (const t of (due.data ?? []) as unknown as TaskRow[]) {
    list.push({
      key: `due-${t.id}`, severity: "info",
      title: `Due today: ${t.title}`,
      body: t.leads?.business_name ?? "",
      href: t.leads ? `/leads/${t.leads.id}` : "/tasks",
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

export function getSeenRaw(): string {
  return localStorage.getItem(SEEN_KEY) ?? "[]";
}

export function getSeenRawServer(): string {
  return "[]";
}

export function markSeen(keys: string[]) {
  const seen = new Set<string>(JSON.parse(getSeenRaw()));
  let changed = false;
  for (const k of keys) {
    if (!seen.has(k)) {
      seen.add(k);
      changed = true;
    }
  }
  if (!changed) return;
  // cap so stale keys don't grow forever
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  listeners.forEach((cb) => cb());
}
