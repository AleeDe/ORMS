"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
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
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Guide", icon: HelpCircle },
];

// Unseen notifications: feed items whose keys the user hasn't viewed on the
// Notifications page yet (visiting the page marks everything seen).
function useAlertCount() {
  const supabase = createClient();
  const { data: items } = useQuery({
    queryKey: ["notification-feed"],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: () => fetchNotificationFeed(supabase),
  });
  const seenRaw = useSyncExternalStore(subscribeSeen, getSeenRaw, getSeenRawServer);
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
  return (
    <TooltipProvider>
    <nav className="flex-1 space-y-1 px-3">
      {nav.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const showBadge = href === "/notifications" && alertCount > 0;
        const link = (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              collapsed && "justify-center px-2",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
      <header className="flex items-center justify-between border-b bg-sidebar px-4 py-3 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="px-5 py-4 text-left">
              <SheetTitle className="text-lg font-bold tracking-tight">ORMS</SheetTitle>
              <p className="text-xs text-muted-foreground">Outreach OS</p>
            </SheetHeader>
            <div className="flex h-[calc(100%-5rem)] flex-col">
              <NavLinks collapsed={false} alertCount={alertCount} onNavigate={() => setMobileOpen(false)} />
              <div className="border-t p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-3 text-muted-foreground"
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
          "hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-56"
        )}
      >
        <div className={cn("flex items-center py-4", collapsed ? "justify-center px-2" : "justify-between px-5")}>
          {!collapsed && (
            <div>
              <Link href="/" className="text-lg font-bold tracking-tight">ORMS</Link>
              <p className="text-xs text-muted-foreground">Outreach OS</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        <NavLinks collapsed={collapsed} alertCount={alertCount} />
        <div className="border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-full gap-3 text-muted-foreground",
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
