import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/components/providers";
import { GlobalSearch } from "@/components/global-search";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-end border-b bg-background px-4 py-2 md:px-6">
            <GlobalSearch />
          </div>
          <main className="flex-1 overflow-y-auto bg-muted/20 p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </Providers>
  );
}
