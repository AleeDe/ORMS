"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { authFlowError, passwordResetDestination } from "@/lib/auth-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PasswordUpdateForm({ tokenHash, next = "/" }: { tokenHash?: string; next?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const destination = passwordResetDestination(next);
  const locked = useRef(false);
  const verified = useRef(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [checking, setChecking] = useState(!tokenHash);
  const [ready, setReady] = useState(Boolean(tokenHash));
  const reset = `/login/forgot-password?next=${encodeURIComponent(destination)}`;

  useEffect(() => {
    if (tokenHash) return;
    let active = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.user) { router.replace(`${reset}&error=invalid_link`); return; }
      setReady(true); setChecking(false);
    }).catch(() => { if (active) { setError("We could not check your session. Reload this page to try again."); setChecking(false); } });
    return () => { active = false; };
  }, [supabase, tokenHash, router, reset]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !ready) return;
    if (password !== confirm) { setError("Those passwords don't match."); return; }
    locked.current = true; setBusy(true); setError("");
    try {
      // GET only displays this form. Scanners and prefetches cannot consume the
      // one-time token; verification happens after the user submits a password.
      if (tokenHash && !verified.current) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (error) throw error;
        verified.current = true;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword(""); setConfirm(""); setComplete(true);
      router.replace(destination); router.refresh();
    } catch (error) {
      const detail = error as { code?: string; message?: string };
      setError(detail.code === "same_password" || detail.message?.includes("different from the old") ? "Pick a password you haven't used before." : authFlowError(error));
    } finally { locked.current = false; setBusy(false); }
  }

  return <main className="grid min-h-svh place-items-center bg-background p-5">
    <Card className="w-full max-w-sm">
      <CardHeader><CardTitle className="text-2xl">{complete ? "Password updated." : "Choose a new password"}</CardTitle><CardDescription>{complete ? "Your new password is ready. Taking you back to ORMS…" : "Use a unique password with at least 6 characters."}</CardDescription></CardHeader>
      <CardContent>
        {complete ? <div className="space-y-4"><CheckCircle2 className="size-9 text-teal-600" aria-hidden="true" /><Button asChild className="min-h-12 w-full"><Link href={destination}>Continue</Link></Button></div> : checking ? <p role="status" className="text-sm text-muted-foreground">Checking your session…</p> : <form className="space-y-4" onSubmit={submit} aria-busy={busy}>
          <div className="space-y-2"><Label htmlFor="password">New password</Label><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={6} autoFocus disabled={busy || !ready} value={password} onChange={event => setPassword(event.target.value)} className="min-h-12 text-base!" /></div>
          <div className="space-y-2"><Label htmlFor="confirm">Confirm new password</Label><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={6} disabled={busy || !ready} value={confirm} onChange={event => setConfirm(event.target.value)} className="min-h-12 text-base!" /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="min-h-12 w-full" disabled={busy || !ready}>{busy && <LoaderCircle className="size-4 motion-safe:animate-spin" />}{busy ? "Updating password…" : "Update password"}</Button>
          {tokenHash && <p className="text-center text-xs leading-5 text-muted-foreground">If this link was already used, request a new reset email.</p>}
          <Button asChild variant="ghost" className="min-h-11 w-full"><Link href={tokenHash ? reset : destination}>{tokenHash ? "Request a new reset link" : "Cancel"}</Link></Button>
        </form>}
      </CardContent>
    </Card>
  </main>;
}
