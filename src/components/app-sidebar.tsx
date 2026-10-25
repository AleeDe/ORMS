"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "@/components/workspace-link";
import { usePathname, useRouter } from "@/lib/workspace-navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace, useWorkspaceClient } from "@/components/workspace-provider";
import { SlidingCapsule } from "@/components/ui/sliding-capsule";
import {
  fetchNotificationFeed, subscribeSeen, getSeenRaw, getSeenRawServer,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  Database,
  Users,
  Contact,
  Megaphone,
  CheckSquare,
  BarChart3,
  Bell,
  Settings,
  HelpCircle,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/datasets", label: "Datasets", icon: Database },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/people", label: "People", icon: Contact },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/team", label: "Team & access", icon: Users },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Guide", icon: HelpCircle },
];

// Unseen notifications: feed items whose keys the user hasn't viewed on the
// Notifications page yet (visiting the page marks everything seen).
function useAlertCount() {
  const supabase = useWorkspaceClient();
  const { workspace, userId } = useWorkspace();
  const { data: items } = useQuery({
    queryKey: ["notification-feed"],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: () => fetchNotificationFeed(supabase),
  });
  const seenRaw = useSyncExternalStore(subscribeSeen, () => getSeenRaw(`${userId}:${workspace.id}`), getSeenRawServer);
  const seen = new Set<string>(JSON.parse(seenRaw));
  return (items ?? []).filter((i) => !seen.has(i.key)).length;
}

function NavLinks({
  collapsed,
  alertCount,
  onNavigate,
}: {
  collapsed: boolean;
  alertCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { isOwner } = useWorkspace();
  return (
    <TooltipProvider>
    <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto px-3">
      <div className="group/sidebar-nav relative isolate flex flex-col gap-1">
      <SlidingCapsule
        activeSelector='a[aria-current="page"]'
        itemSelector="a[data-sidebar-link]"
        className="rounded-xl bg-sidebar-primary dark:border-transparent dark:bg-sidebar-primary"
      />
      {nav.filter((item) => isOwner || ["/campaigns", "/tasks", "/notifications", "/help"].includes(item.href)).map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const showBadge = href === "/notifications" && alertCount > 0;
        const link = (
          <Link
            key={href}
            href={href}
            data-sidebar-link
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? label : undefined}
            onClick={onNavigate}
            className={cn(
              "relative z-10 flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              collapsed && "justify-center px-2",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm group-data-[capsule-ready=true]/sidebar-nav:bg-transparent! group-data-[capsule-ready=true]/sidebar-nav:shadow-none!"
                : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            <span className="relative">
              <Icon className="h-4 w-4" />
              {showBadge && collapsed && (
                <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-destructive" />
              )}
            </span>
            {!collapsed && label}
            {showBadge && !collapsed && (
              <Badge variant="destructive" className="ml-auto h-5 min-w-5 justify-center px-1.5">
                {alertCount > 99 ? "99+" : alertCount}
              </Badge>
            )}
          </Link>
        );
        return collapsed ? (
          <Tooltip key={href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
      </div>
    </nav>
    </TooltipProvider>
  );
}

const COLLAPSE_KEY = "orms-sidebar-collapsed";
const collapseListeners = new Set<() => void>();
function subscribeCollapse(cb: () => void) {
  collapseListeners.add(cb);
  return () => collapseListeners.delete(cb);
}

export function AppSidebar() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const alertCount = useAlertCount();

  const collapsed = useSyncExternalStore(
    subscribeCollapse,
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
    () => false
  );
  function toggleCollapsed() {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
    collapseListeners.forEach((cb) => cb());
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-3 text-sidebar-foreground md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
            <SheetHeader className="px-5 py-4 text-left">
              <SheetTitle className="text-lg font-bold tracking-tight">ORMS</SheetTitle>
              <p className="text-xs text-sidebar-foreground/50">Outreach, with intention.</p>
            </SheetHeader>
            <div className="flex h-[calc(100%-5rem)] flex-col">
              <NavLinks collapsed={false} alertCount={alertCount} onNavigate={() => setMobileOpen(false)} />
              <div className="border-t p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-3 text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  onClick={signOut}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        <Link href="/" className="text-lg font-bold tracking-tight">ORMS</Link>
        <Button variant="ghost" size="icon" aria-label="Notifications" asChild>
          <Link href="/notifications" className="relative">
            <Bell className="h-5 w-5" />
            {alertCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
            )}
          </Link>
        </Button>
      </header>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:flex",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <div className={cn("flex items-center py-4", collapsed ? "justify-center px-2" : "justify-between px-5")}>
          {!collapsed && (
            <div>
              <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight"><span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-teal-400"><Megaphone className="size-4 text-white" /></span> ORMS<span className="size-1.5 rounded-full bg-teal-400" /></Link>
              <p className="mt-2 text-xs text-sidebar-foreground/45">Outreach, with intention.</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        {!collapsed && <p className="mb-3 mt-5 px-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/35">Workspace</p>}
        <NavLinks collapsed={collapsed} alertCount={alertCount} />
        {!collapsed && <div className="mx-3 mb-4 rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs font-medium text-sidebar-foreground/80">Small touches. Real momentum.</p><p className="mt-1 text-xs leading-relaxed text-sidebar-foreground/45">Your next conversation starts with one lead.</p></div>}
        <div className="border-t border-sidebar-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-full gap-3 text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              collapsed ? "justify-center" : "justify-start"
            )}
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && "Sign out"}
          </Button>
        </div>
      </aside>
    </>
  );
}
