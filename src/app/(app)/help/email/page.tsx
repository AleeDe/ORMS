"use client";

import Link from "next/link";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  KeyRound, Globe, AtSign, ListOrdered, Mail, ArrowLeft, AlertTriangle, Send,
} from "lucide-react";

// Field-by-field guide for Settings → Email. Written for someone setting this up
// for the first time, in the order they will actually meet each field.
export default function EmailGuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/help"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Guide</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Email setup — every field explained</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set up once in this order: connect a Resend account → add a domain → publish DNS →
          add a sender → send a test → build a sequence. Each step below is one tab in{" "}
          <Link href="/settings/email" className="text-primary hover:underline">Settings → Email</Link>.
        </p>
      </div>

      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" /> The one rule that matters
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">ORMS never sends email on its own.</strong> It prepares
            each follow-up on schedule and puts it in{" "}
            <Link href="/emails" className="text-primary hover:underline">Ready to Review</Link>.
            An email only leaves when you click <strong>Send</strong>.
          </p>
          <p>
            Replies are <strong className="text-foreground">not</strong> detected automatically —
            there is no inbox connection. When a lead replies, open the lead (or the queue) and click{" "}
            <em>Lead replied — stop</em> so the sequence halts.
          </p>
        </CardContent>
      </Card>

      {/* 1. Accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> 1. Resend accounts
          </CardTitle>
          <CardDescription>
            Where sending happens. You can connect more than one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Field
            name="API key"
            what="The password that lets ORMS use your Resend account."
            how={
              <>
                In Resend go to <strong>API Keys → Create API Key</strong>. Set{" "}
                <strong>Permission</strong> to <strong>Full access</strong>, then copy the key
                (it starts with <code>re_</code>) and paste it here.
              </>
            }
            warn={
              <>
                <strong>&quot;Sending access&quot; is not enough.</strong> That kind of key can send mail
                but cannot register or verify domains, and Resend reports the failure as a confusing
                server error. If connecting fails, this is almost always why.
              </>
            }
          />
          <Field
            name="Label"
            what="A name so you can tell your accounts apart. Optional."
            how={<>Use whatever reminds you which login it is, e.g. <em>ReviewYourDoctor Gmail</em>.</>}
          />
          <Note>
            <strong>Why more than one account?</strong> A domain can only live in one Resend account.
            If one domain sits under a different Resend login than another, connect both accounts
            here and ORMS will use them together — it picks the right key per domain automatically.
          </Note>
          <Note>
            Your key is encrypted before it is stored and is never shown again — the list only shows
            the last 4 characters. To replace a key, disconnect the account and connect it again.
          </Note>
        </CardContent>
      </Card>

      {/* 2. Domains */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" /> 2. Domains
          </CardTitle>
          <CardDescription>The web address your email comes from.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Field
            name="Domain"
            what="The bare domain — no https://, no www, no trailing slash."
            how={<>Example: <code>reviewyourdoctor.co.uk</code></>}
          />
          <Field
            name="Register under"
            what="Which connected Resend account this domain belongs to."
            how={
              <>
                If the domain is already in one of your Resend accounts, pick <em>that</em> account —
                ORMS will adopt it instead of registering it again, so you keep the DNS you already
                published.
              </>
            }
            warn={
              <>
                Pick the wrong account and Resend replies{" "}
                <em>&quot;already registered&quot;</em> — meaning the domain exists, but under a
                different login. Connect that account&apos;s key first.
              </>
            }
          />
          <Field
            name="Status"
            what="Resend's verdict, not ours."
            how={
              <ul className="ml-4 list-disc space-y-1">
                <li><Badge variant="outline">not_started</Badge> — added, DNS not published yet</li>
                <li><Badge variant="outline">pending</Badge> — Resend is checking your DNS</li>
                <li><Badge variant="outline">verified</Badge> — ready to send</li>
                <li><Badge variant="outline">failed</Badge> — records missing or wrong</li>
              </ul>
            }
          />
          <Field
            name="DNS records table"
            what="What you must add at your DNS provider (Cloudflare, etc)."
            how={
              <>
                Copy each row into your DNS as-is — matching <strong>Type</strong>,{" "}
                <strong>Name</strong> and <strong>Value</strong>. Then come back and hit{" "}
                <strong>Verify</strong>. DNS can take minutes to hours to propagate; if it still says
                pending, wait and hit Verify again.
              </>
            }
            warn={
              <>
                <strong>Keep exactly one SPF record.</strong> If your domain already has an SPF TXT
                record (Cloudflare Email Routing adds one), do <em>not</em> add a second — merge
                Resend&apos;s <code>include:</code> into the existing one. Two SPF records silently
                send your mail to spam.
              </>
            }
          />
        </CardContent>
      </Card>

      {/* 3. Senders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AtSign className="h-4 w-4" /> 3. Senders
          </CardTitle>
          <CardDescription>The actual &quot;From&quot; on the email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Field
            name="Domain"
            what="Which verified domain this address belongs to."
            how={<>Only verified domains appear — verify first.</>}
          />
          <Field
            name="Address"
            what="The part before the @."
            how={<>Type <code>sarah</code> to get <code>sarah@yourdomain.com</code>. You can add as many as you like on one domain.</>}
          />
          <Field
            name="Display name"
            what="The name the recipient sees in their inbox, instead of the raw address."
            how={<>e.g. <em>Sarah from ReviewYourDoctor</em>. For cold outreach a real person&apos;s name usually reads better than a company name.</>}
          />
          <Field
            name="Reply-to (optional)"
            what="Where replies go, if that differs from the sending address."
            how={
              <>
                Leave blank and replies go to the sending address. Set it if you send from{" "}
                <code>outreach@…</code> but read mail somewhere else. <strong>Make sure you can
                actually read whatever you put here</strong> — this is where every lead&apos;s answer
                lands.
              </>
            }
          />
          <Field
            name="Signature (optional)"
            what="Text appended to the bottom of every email from this sender."
            how={<>Keeps sign-offs out of your templates. Plain text only.</>}
          />
          <Note icon={<Send className="h-4 w-4" />}>
            <strong>Send test</strong> on any sender row sends a real email to you. Do this before
            enrolling leads — it proves the domain, DNS and key all work, shows how your sender name
            looks in a real inbox, and lets you hit reply to confirm replies land where you expect.
          </Note>
        </CardContent>
      </Card>

      {/* 4. Sequences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListOrdered className="h-4 w-4" /> 4. Sequences
          </CardTitle>
          <CardDescription>The follow-up plan ORMS schedules for you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Field
            name="Name"
            what="What this sequence is for."
            how={<>e.g. <em>Cold Outreach</em>, <em>Warm Outreach</em>, <em>Referral</em>.</>}
          />
          <Field
            name="Sends from"
            what="Which sender every email in this sequence comes from."
            how={
              <>
                Pinned to each lead when they are enrolled, so a lead never hears from two different
                people mid-conversation.
              </>
            }
          />
          <Field
            name="Stop when the lead replies"
            what="Halts the sequence once a reply is recorded."
            how={
              <>
                Because there is no inbox connection, <strong>you</strong> record the reply — via{" "}
                <em>Lead replied — stop</em> in the queue, or by quick-logging a Reply on the lead.
                Leave this on.
              </>
            }
          />
          <Field
            name="Stop when a meeting is booked"
            what="Halts the sequence when you log a booked meeting."
            how={<>Stops you chasing someone who has already said yes.</>}
          />
          <Field
            name="Business days after the previous step"
            what="The wait before this step becomes due."
            how={
              <>
                Business days only — weekends are skipped. Step 1 has no delay; it is due as soon as
                you enrol the lead. The clock for step 2 starts when you <em>actually send</em> step
                1, so a late send shifts everything after it.
              </>
            }
          />
          <Field
            name="Subject and message"
            what="What you actually write — with details that change per lead."
            how={
              <>
                You never need to type the <code>{"{{ }}"}</code> codes. Write normally, and where you
                want the lead&apos;s own detail, click a button like <strong>First name</strong> or{" "}
                <strong>Business name</strong> — it drops in at your cursor. Your imported
                spreadsheet columns appear as buttons too. Hit{" "}
                <strong>Preview with a real lead</strong> to see the finished email before saving.
              </>
            }
            warn={
              <>
                <strong>First name</strong> becomes &quot;there&quot; when a lead has no contact name,
                so &quot;Hi there,&quot; still reads normally. Anything that can&apos;t be filled in
                is removed — a lead never sees raw <code>{"{{ }}"}</code> text.
              </>
            }
          />
        </CardContent>
      </Card>

      {/* Daily use */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> 5. Using it day to day
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Enrol a lead</p>
            <p>
              Open a lead → <strong>Email sequences</strong> → pick a sequence → <strong>Enrol</strong>.
              The lead needs at least one email address. Step 1 appears in Ready to Review straight away.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Each morning</p>
            <p>
              Open <Link href="/emails" className="text-primary hover:underline">Ready to Review</Link>{" "}
              and work the <strong>Due Today</strong> tab. Per email you can{" "}
              <strong>Send</strong>, <strong>Edit</strong> (this copy only — the template is
              untouched), <strong>Skip</strong> (moves on without sending),{" "}
              <strong>Pause sequence</strong>, or <strong>Lead replied — stop</strong>.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">After you send</p>
            <p>
              ORMS logs it on the lead&apos;s timeline, bumps the touch count, suggests a status
              change, and schedules the next step. Follow-ups are threaded under the first email, so
              they stack in one conversation in the lead&apos;s inbox.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">If something goes wrong</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <Trouble
            problem="Connecting a key fails with a vague error"
            fix={<>The key is almost certainly <strong>Sending access</strong>. Create a new one with <strong>Full access</strong>.</>}
          />
          <Trouble
            problem="&quot;Already registered&quot; when adding a domain"
            fix={<>It belongs to a different Resend account. Connect that account&apos;s key, then pick it under <em>Register under</em>.</>}
          />
          <Trouble
            problem="Domain stuck on pending"
            fix={<>DNS hasn&apos;t propagated or a record is mistyped. Compare every row against your DNS provider, then Verify again.</>}
          />
          <Trouble
            problem="Test email never arrives"
            fix={<>Check spam. A brand-new domain has no sending reputation — start with low volume and build up.</>}
          />
          <Trouble
            problem="Send button says the domain isn't verified"
            fix={<>Only verified domains can send. Finish verification on the Domains tab first.</>}
          />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild><Link href="/settings/email">Open Email settings</Link></Button>
        <Button variant="outline" asChild><Link href="/help">Back to Guide</Link></Button>
      </div>
    </div>
  );
}

function Field({
  name, what, how, warn,
}: {
  name: string;
  what: string;
  how?: React.ReactNode;
  warn?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3 space-y-1.5">
      <p className="font-medium">{name}</p>
      <p className="text-muted-foreground">{what}</p>
      {how && <p className="text-muted-foreground">{how}</p>}
      {warn && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
          {warn}
        </p>
      )}
    </div>
  );
}

function Note({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <span>{children}</span>
    </div>
  );
}

function Trouble({ problem, fix }: { problem: string; fix: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium text-foreground">{problem}</p>
      <p>{fix}</p>
    </div>
  );
}
