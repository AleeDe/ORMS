"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import { ArrowRight, Check, Database, FileSpreadsheet, Layers3, Megaphone, Sparkles, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const WORKFLOW = [
  { id: "import", label: "Import", icon: Database, title: "A fresh start for your data.", description: "Bring in your spreadsheets. Every contact joins one shared lead library." },
  { id: "discover", label: "Discover", icon: Users, title: "Find your next conversation.", description: "Filter your library to find the right people for each outreach effort." },
  { id: "connect", label: "Connect", icon: Megaphone, title: "Give every campaign its own story.", description: "Keep touches, notes, and follow-ups separate, even when leads overlap." },
];

export function LoginBrand({ dark = false }: { dark?: boolean }) {
  return <Link href="/login" aria-label="ORMS sign in" className="inline-flex w-fit items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
    <span className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-teal-400 text-white shadow-sm"><Megaphone className="size-5" /></span>
    <span className={`text-2xl font-bold tracking-tight ${dark ? "text-white" : "text-foreground"}`}>ORMS<span className="text-teal-400">.</span></span>
  </Link>;
}

export function LoginShowcase() {
  const [step, setStep] = useState("import");
  const index = WORKFLOW.findIndex((item) => item.id === step);

  return <aside className="relative m-4 hidden min-w-0 flex-col justify-between overflow-hidden rounded-[2rem] bg-slate-950 p-8 text-white lg:flex xl:p-12" aria-label="Explore the ORMS workflow">
    <div aria-hidden="true" className="pointer-events-none absolute -right-28 -top-20 size-96 rounded-full bg-indigo-500/20 blur-[100px]" />
    <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 -left-20 size-96 rounded-full bg-teal-400/10 blur-[100px]" />
    <div className="relative flex items-center justify-between gap-4"><LoginBrand dark /><span className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] tracking-wide text-slate-300">Outreach, with intention.</span></div>

    <div className="relative mx-auto w-full max-w-lg py-10 xl:py-12">
      <p className="mb-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-teal-300"><Sparkles className="size-4" /> Small touches. Real momentum.</p>
      <h2 className="text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">Good outreach<br />starts with <span className="bg-gradient-to-r from-indigo-300 to-teal-300 bg-clip-text text-transparent">a hello.</span></h2>
      <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">A clear place for your data, your people, and the conversations that come next.</p>

      <Tabs value={step} onValueChange={setStep} className="mt-8 gap-4">
        <TabsList aria-label="Explore your outreach workflow" indicatorClassName="rounded-lg border-white/10 bg-white/10 dark:border-white/10 dark:bg-white/10" className="grid h-auto! w-full grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {WORKFLOW.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id} className="min-h-11 gap-2 rounded-lg text-slate-400 hover:text-white data-[state=active]:bg-white/10 data-[state=active]:text-white"><Icon className="size-4" />{label}</TabsTrigger>)}
        </TabsList>
        {WORKFLOW.map((item) => <TabsContent key={item.id} value={item.id} className="min-h-64 rounded-2xl border border-white/10 bg-white/[0.04] p-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 xl:p-6">
          <div aria-hidden="true" className="mb-5 flex h-28 items-center justify-center rounded-xl border border-white/5 bg-slate-900/70">
            {item.id === "import" ? <div className="flex items-center gap-4"><span className="flex size-14 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10 text-teal-300"><FileSpreadsheet className="size-7" /></span><div><p className="text-sm font-medium text-slate-200">Your next audience</p><p className="mt-1 text-xs text-slate-500">CSV / Excel → Lead library</p><div className="mt-3 flex gap-1.5">{["w-12", "w-8", "w-16"].map((width) => <span key={width} className={`h-1 rounded-full bg-teal-300/30 ${width}`} />)}</div></div></div>
              : item.id === "discover" ? <div className="w-full space-y-2 px-5">{["Practice owners", "Founders", "New prospects"].map((name, row) => <div key={name} className="flex items-center gap-3 text-xs"><span className={`flex size-6 items-center justify-center rounded-lg ${row === 1 ? "bg-teal-300/15 text-teal-300" : "bg-indigo-300/15 text-indigo-300"}`}><Users className="size-3" /></span><span className="flex-1 text-slate-300">{name}</span><Check className="size-3.5 text-teal-300" /></div>)}</div>
                : <div className="flex w-full items-center justify-center gap-3 px-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-400/15 text-indigo-300"><Users className="size-5" /></div><div className="space-y-2"><div className="flex items-center gap-2 rounded-lg border border-indigo-300/15 bg-indigo-400/10 px-3 py-2 text-xs"><span className="size-1.5 rounded-full bg-indigo-300" />Campaign A<span className="ml-2 text-indigo-300">First touch</span></div><div className="flex items-center gap-2 rounded-lg border border-teal-300/15 bg-teal-400/10 px-3 py-2 text-xs"><span className="size-1.5 rounded-full bg-teal-300" />Campaign B<span className="ml-2 text-teal-300">Follow-up</span></div></div></div>}
          </div>
          <h3 className="text-sm font-semibold text-slate-100">{item.title}</h3>
          <p className="mt-2 text-xs leading-6 text-slate-400">{item.description}</p>
        </TabsContent>)}
      </Tabs>
      <div className="mt-4 flex items-center justify-between"><span className="font-mono text-xs tracking-widest text-slate-500">0{index + 1} <span className="mx-1 text-slate-700">/</span> 03</span><button type="button" onClick={() => setStep(WORKFLOW[(index + 1) % WORKFLOW.length].id)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs text-slate-300 transition-colors hover:text-teal-300 focus-visible:outline-2 focus-visible:outline-teal-300">Explore the next step <ArrowRight className="size-3.5" /></button></div>
    </div>
    <p className="relative flex items-center gap-2 text-xs text-slate-500"><Layers3 className="size-4 text-slate-400" /> One lead library. Independent campaign journeys.</p>
  </aside>;
}
