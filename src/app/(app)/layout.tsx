import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/components/providers";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto bg-muted/20 p-4 md:p-6">
          {children}
        </main>
      </div>
    </Providers>
  );
}
