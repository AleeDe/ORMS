"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { authFlowError, verifySignupCode } from "@/lib/auth-flow";
import { safeReturnPath } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EmailVerification({ email, next, sent, onBack }: { email: string; next: string; sent: boolean; onBack: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const locked = useRef(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"verify" | "resend" | "opening" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(sent ? 60 : 0);
  const [requested, setRequested] = useState(sent);
  const destination = safeReturnPath(next);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true; setBusy("verify"); setError("");
    try {
      const { error } = await verifySignupCode(supabase.auth, email, code);
      if (error) throw error;
      setBusy("opening");
      router.replace(destination); router.refresh();
    } catch (error) { setError(authFlowError(error)); setBusy(null); }
    finally { locked.current = false; }
  }
  async function resend() {
    if (locked.current || cooldown) return;
    locked.current = true; setBusy("resend"); setError(""); setNotice("");
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${location.origin}/auth/confirm?next=${encodeURIComponent(destination)}` } });
      if (error) throw error;
      setCode(""); setCooldown(60); setRequested(true); setNotice("A fresh code has been requested. Check your inbox and spam folder.");
    } catch (error) { setError(authFlowError(error)); }
    finally { locked.current = false; setBusy(null); }
  }
  return <div className="rounded-3xl border bg-card p-6 shadow-sm sm:p-9">
    <MailCheck className="mb-5 size-10 text-teal-600" aria-hidden="true" />
    <h1 className="text-3xl font-semibold tracking-tight">Verify your email.</h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">{requested ? <>Enter the code sent to <strong className="break-all text-foreground">{email}</strong>. Check your spam folder too.</> : <>Your email <strong className="break-all text-foreground">{email}</strong> still needs verification. Request a code below to continue.</>}</p>
    <form className="mt-6 space-y-4" onSubmit={verify} aria-busy={busy === "verify" || busy === "opening"}>
      <Label htmlFor="verification-code">Verification code</Label>
      <Input id="verification-code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required minLength={6} maxLength={10} pattern="[0-9]{6,10}" value={code} disabled={Boolean(busy)} onChange={event => { setCode(event.target.value.replace(/\D/g, "")); setError(""); }} className="h-12 text-center font-mono text-xl! tracking-[0.25em]" aria-describedby="verification-help" />
      <p id="verification-help" className="text-xs leading-5 text-muted-foreground">Use the most recent code. Already have a verified account? Sign in below instead.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      <Button className="min-h-12 w-full" disabled={Boolean(busy) || code.length < 6}>{busy === "verify" || busy === "opening" ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : <ArrowRight className="size-4" />}{busy === "opening" ? "Opening your workspace…" : busy === "verify" ? "Verifying…" : "Verify email"}</Button>
    </form>
    <Button variant="outline" className="mt-3 min-h-11 w-full" disabled={Boolean(busy) || cooldown > 0} onClick={resend}>{busy === "resend" ? "Sending code…" : cooldown ? `Resend code in ${cooldown}s` : requested ? "Resend code" : "Send verification code"}</Button>
    <Button variant="ghost" className="mt-2 min-h-11 w-full" disabled={Boolean(busy)} onClick={onBack}>Back to sign in</Button>
    <Link href={`/login/forgot-password?next=${encodeURIComponent(destination)}`} className="mt-3 block text-center text-xs text-primary underline-offset-4 hover:underline">Forgot your password?</Link>
  </div>;
}
