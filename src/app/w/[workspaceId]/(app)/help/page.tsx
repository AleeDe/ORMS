"use client";

import Link from "@/components/workspace-link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, Search, ListChecks, Mail, Users, Filter } from "lucide-react";

// Plain-language guide to the features that aren't self-explanatory.
export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Guide</h1>
        <p className="text-sm text-muted-foreground">
          How the main features work. Everything here is optional — the app works without any setup.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader><CardTitle className="text-base">One library. Independent campaign journeys.</CardTitle><CardDescription>Your workflow from import to outreach.</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p><strong className="text-foreground">1. Import a dataset.</strong> Every imported contact becomes a lead in your shared library. Use filters to find your audience.</p>
          <p><strong className="text-foreground">2. Add leads to a campaign.</strong> Open a campaign and choose Add leads, or select leads in the library and add them to a campaign. Each new membership starts fresh.</p>
          <p><strong className="text-foreground">3. Work inside that campaign.</strong> Touch counts, status, notes, timelines, and tasks stay with the selected campaign. The same lead can have different progress in another campaign. Contact details stay shared.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="h-4 w-4" /> Google Calendar sync
          </CardTitle>
          <CardDescription>
            Connect once and booked meetings & new tasks appear on your Google Calendar automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium">How to connect</p>
            <ol className="ml-5 list-decimal space-y-1 text-muted-foreground">
              <li>
                Go to <Link href="/settings" className="text-primary hover:underline">Settings</Link>{" "}
                → <strong>Google Calendar</strong> → <strong>Connect Google Calendar</strong>.
              </li>
              <li>Sign in with your Google account and allow calendar access.</li>
              <li>You&apos;ll come back to Settings showing “Connected as …”. That&apos;s it.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium">What gets added</p>
            <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
              <li>
                <strong>Meetings:</strong> on a lead, click <em>Meeting Booked</em>, pick the date
                &amp; time, and it&apos;s placed on your calendar.
              </li>
              <li>
                <strong>Tasks:</strong> any task you add (lead page or Tasks page) is added at 9:00am
                on its due date.
              </li>
            </ul>
          </div>
          <p className="text-muted-foreground">
            No calendar connected? Nothing breaks — you still get an{" "}
            <strong>Add to calendar</strong> button on tasks that gives a Google link or an{" "}
            <code>.ics</code> file for Apple/Outlook.
          </p>
          <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
            One-time server setup is required before the Connect button works (Google API keys).
            If it shows an error, the keys aren&apos;t set yet.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> “Email sent” history from your sheet
          </CardTitle>
          <CardDescription>What that imported activity on your timeline means.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Your old sheet had a <strong>“Reached Date”</strong> column (the day you emailed a clinic)
            and a <strong>Status</strong> of “Sent”. The app read those and, for each such lead,
            created one <Badge className="mx-1" variant="secondary">Email sent</Badge> entry on that
            date on the lead&apos;s timeline — marked{" "}
            <span className="italic">“Imported: reached (sheet)”</span>.
          </p>
          <p>
            <strong>Why it matters:</strong> before this, those past contacts weren&apos;t recorded
            anywhere the app could see, so your “first touch” filters and per-channel touch counts
            ignored them. Now they count. This was a one-time backfill of your existing history — going
            forward, every touch you log is recorded live.
          </p>
          <p>
            It does <strong>not</strong> send any email — the app never sends email. It only records
            that a contact happened, so your timeline and reports are complete.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" /> Finding a lead fast
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Use the search box at the top (or press <kbd className="rounded border px-1">Ctrl</kbd>/
            <kbd className="rounded border px-1">⌘</kbd> + <kbd className="rounded border px-1">K</kbd>).
            Type <strong>anything</strong> — a name, a phone number (even a partial one), an email,
            a website, or any custom field value — and it finds the matching lead.
          </p>
          <p>Great for an unknown number that just called: paste it and jump straight to the lead.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" /> Filtering leads
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            On the <Link href="/leads" className="text-primary hover:underline">Leads</Link> page you
            can filter by email, website, phone (including{" "}
            <strong>has a personal number</strong>), person role, any custom field, and a{" "}
            <strong>first-touch date range</strong> (e.g. “leads I first contacted on 21 July”).
          </p>
          <p>
            Your filters are <strong>remembered per dataset</strong> — they don&apos;t reset when you
            move around, so you stay in your campaign&apos;s context. Use{" "}
            <strong>Clear filters</strong> to reset.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> People &amp; channels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            On a lead, add the people you deal with (owner, manager, receptionist…) with their role,
            personal number, email and LinkedIn. See them all on the{" "}
            <Link href="/people" className="text-primary hover:underline">People</Link> page.
          </p>
          <p>
            Set an <strong>outreach channel</strong> on the campaign page to use it for every lead,
            or choose per touch (business email, business number, personal number…). An unambiguous
            linked contact is preselected. The lead page then shows{" "}
            <strong>Touches by channel</strong> — how many times, through what, and when.
          </p>
          <p>Inside a campaign lead, press <kbd className="rounded border px-1">N</kbd> for the next lead or <kbd className="rounded border px-1">P</kbd> for the previous one. Shortcuts pause while you type, open a menu, or have an unsaved draft. Navigation follows the full campaign in newest-added order.</p>
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Team &amp; campaign access</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>The owner manages invitations and campaign permissions from Team &amp; access. Choose a teammate&apos;s existing email, campaigns and role, then send an invitation email. If email delivery is not configured, you can share the generated link. The teammate signs in or creates an account with that email and accepts the invitation.</p><p>Members log outreach and complete their assigned or unassigned tasks. Managers can also assign and manage campaign tasks. Viewers can read the campaign. Contact edits, imports, campaign settings, and access management belong to the owner.</p><p>Each touch records who logged it. Tasks record the assignee and who completed them. Removing access preserves history and releases unfinished assignments. Use the workspace selector at the top to switch companies, open All workspaces, or create your own workspace. One account can own several workspaces and join others. Data and permissions stay separate; each browser tab keeps the workspace in its URL.</p></CardContent></Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" /> Tasks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Add a task manually from a lead (Tasks card → <strong>Add task</strong>) or the{" "}
            <Link href="/tasks" className="text-primary hover:underline">Tasks</Link> page — just a
            short note and a date. Some quick-log actions also create follow-up tasks automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
