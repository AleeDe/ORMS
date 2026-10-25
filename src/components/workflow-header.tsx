import type { ReactNode } from "react";
import Link from "@/components/workspace-link";
import { ArrowRight, Database, Users, Megaphone } from "lucide-react";

const steps = [
  { title: "Datasets", detail: "Import your source data", href: "/datasets", icon: Database },
  { title: "Lead library", detail: "Find the right audience", href: "/leads", icon: Users },
  { title: "Campaigns", detail: "Build each relationship", href: "/campaigns", icon: Megaphone },
];

export function WorkflowHeader({ step, title, description, actions, showSteps = true }: {
  step: 1 | 2 | 3; title: ReactNode; description: string; actions?: ReactNode; showSteps?: boolean;
}) {
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Your outreach, in motion</p>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {showSteps && <nav aria-label="Outreach workflow" className="grid gap-2 sm:grid-cols-3">
      {steps.map(({ title: name, detail, href, icon: Icon }, index) => <Link key={href} href={href}
        aria-current={step === index + 1 ? "step" : undefined}
        className={`group flex items-center gap-3 rounded-xl border p-3 transition-colors ${step === index + 1 ? "border-primary/25 bg-primary/5" : "border-border/70 bg-card/70 hover:border-primary/25"}`}>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${step === index + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold"><span className="mr-1 text-xs opacity-50">0{index + 1}</span> {name}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>)}
    </nav>}
  </div>;
}
