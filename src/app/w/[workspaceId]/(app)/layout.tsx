import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/components/providers";
import { GlobalSearch } from "@/components/global-search";
import { OwnerOnly, WorkspaceGuard } from "@/components/workspace-provider";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur md:px-8">
            <p className="hidden text-sm font-medium text-muted-foreground sm:block">Your outreach workspace <span className="ml-3 inline-flex items-center gap-1.5 text-xs"><span className="size-1.5 rounded-full bg-teal-500" /> Make every touch count</span></p>
            <WorkspaceSwitcher />
            <OwnerOnly><GlobalSearch /></OwnerOnly>
          </div>
          <main className="flex-1 overflow-y-auto bg-background p-4 md:p-8">
            <div className="mx-auto w-full max-w-7xl"><WorkspaceGuard>{children}</WorkspaceGuard></div>
          </main>
        </div>
      </div>
    </Providers>
  );
}
