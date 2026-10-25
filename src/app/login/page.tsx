"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, CheckCircle2, CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, MailCheck, ShieldCheck, Sparkles } from "lucide-react";
import { LoginBrand, LoginShowcase } from "@/components/login-showcase";
import { safeReturnPath } from "@/lib/workspace";
import { SlidingCapsule } from "@/components/ui/sliding-capsule";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const busy = loading || navigating;

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setPassword("");
    setShowPassword(false);
    setCapsLock(false);
    setEmailError(null);
    setPasswordError(null);
    setError(null);
    setConfirmationEmail(null);
  }

  function validateEmail() {
    const field = emailInput.current;
    const message = !field?.value.trim() ? "Enter your email address." : !field.validity.valid ? "Enter a valid email address." : null;
    setEmailError(message);
    return !message;
  }

  function checkCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const validEmail = validateEmail();
    const passwordMessage = !password ? "Enter your password." : mode === "signup" && password.length < 6 ? "Use at least 6 characters for your password." : null;
    setPasswordError(passwordMessage);
    if (!validEmail || passwordMessage) {
      (validEmail ? passwordInput : emailInput).current?.focus();
      return;
    }
    setLoading(true);
    try {
      const next = safeReturnPath(new URLSearchParams(location.search).get("next"));
      const { data, error: authError } = mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${location.origin}/auth/confirm?next=${encodeURIComponent(next)}` } });
      if (authError) {
        setError(authError.code === "invalid_credentials"
          ? "That email and password don’t match. Check them and try again."
          : authError.name === "AuthRetryableFetchError"
            ? "We couldn’t connect right now. Check your connection and try again."
            : authError.message);
        return;
      }
      if (mode === "signup" && !data.session) {
        setConfirmationEmail(email.trim());
        setPassword("");
        return;
      }
      if (!data.session) {
        setError("We couldn’t finish signing you in. Please try again.");
        return;
      }
      setNavigating(true);
      router.replace(next);
      router.refresh();
    } catch {
      setError("We couldn’t connect right now. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="grid min-h-svh bg-background lg:grid-cols-[1.05fr_0.95fr]">
    <LoginShowcase />
    <section aria-label="Access your ORMS workspace" className="flex min-w-0 flex-col px-5 py-7 sm:px-10 lg:px-12 xl:px-20">
      <div className="mb-8 flex items-center justify-between gap-4 lg:hidden"><LoginBrand /><span className="max-w-28 text-right text-xs leading-5 text-muted-foreground">Your outreach workspace</span></div>
      <div className="mx-auto my-auto w-full max-w-[440px] py-4 sm:py-8">
        {confirmationEmail ? <div className="rounded-3xl border bg-card p-6 shadow-sm motion-safe:animate-in motion-safe:fade-in sm:p-9" role="status">
          <span className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-600"><MailCheck className="size-7" /></span>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">One more step</p>
          <h1 className="text-3xl font-semibold tracking-tight">Check your inbox.</h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">Check <strong className="break-all font-medium text-foreground">{confirmationEmail}</strong> for a confirmation link to finish setting up your account.</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Can’t see it? Have a look in your spam folder.</p>
          <Button className="mt-7 h-12 w-full rounded-xl" onClick={() => switchMode("signin")}>Back to sign in <ArrowRight className="size-4" /></Button>
          <button type="button" onClick={() => { setConfirmationEmail(null); setEmail(""); }} className="mt-3 min-h-11 w-full rounded-lg text-sm text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">Use a different email</button>
        </div> : <>
          <div className="mb-7">
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><span className="size-1.5 rounded-full bg-teal-500" /> {mode === "signin" ? "Your next move starts here" : "A fresh start"}</p>
            <h1 className="text-[2rem] font-semibold leading-tight tracking-tight sm:text-4xl">{mode === "signin" ? "Welcome back." : "Create your workspace."}</h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{mode === "signin" ? "Your leads, campaigns, and next conversations. All in one place." : "Bring your audience together. Make every conversation count."}</p>
          </div>
          <div className="rounded-3xl border border-border/80 bg-card p-5 shadow-[0_8px_40px_-20px_rgba(40,35,100,0.18)] sm:p-7">
            <div role="group" className="group/auth-switch relative isolate mb-7 grid grid-cols-2 gap-1 rounded-xl bg-muted/80 p-1" aria-label="Account access options">
              <SlidingCapsule activeSelector='button[aria-pressed="true"]' itemSelector="button[aria-pressed]" className="rounded-lg bg-card dark:bg-card" />
              {(["signin", "signup"] as const).map((option) => <button key={option} type="button" aria-pressed={mode === option} disabled={busy} onClick={() => { if (mode !== option) switchMode(option); }} className={`relative z-10 min-h-11 whitespace-nowrap rounded-lg px-2 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 group-data-[capsule-ready=true]/auth-switch:bg-transparent! group-data-[capsule-ready=true]/auth-switch:shadow-none! sm:text-sm ${mode === option ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{option === "signin" ? "Sign in" : "Create account"}</button>)}
            </div>
            <form noValidate onSubmit={handleSubmit} className="space-y-5" aria-busy={busy}>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
                <div className="relative"><Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-4 size-4 text-muted-foreground" /><Input ref={emailInput} id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required disabled={busy} aria-invalid={!!emailError} aria-describedby={emailError ? "email-error" : undefined} className="h-12 rounded-xl bg-background/40 pl-11 text-base! placeholder:text-muted-foreground/60" placeholder="you@company.com" value={email} onBlur={validateEmail} onChange={(event) => { setEmail(event.target.value); setEmailError(null); setError(null); }} /></div>
                {emailError && <p id="email-error" role="alert" className="text-xs text-destructive">{emailError}</p>}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2"><Label htmlFor="password" className="text-sm font-medium">Password</Label>{mode === "signin" && <Link href="/login/forgot-password" className="inline-flex min-h-7 items-center rounded text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">Forgot password?</Link>}</div>
                <div className="relative"><LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-3.5 top-4 size-4 text-muted-foreground" /><Input ref={passwordInput} id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 6 : undefined} disabled={busy} aria-invalid={!!passwordError} aria-describedby={[passwordError ? "password-error" : "", capsLock ? "caps-lock" : "", mode === "signup" ? "password-hint" : ""].filter(Boolean).join(" ") || undefined} className="h-12 rounded-xl bg-background/40 pl-11 pr-12 text-base! placeholder:text-muted-foreground/60" placeholder={mode === "signin" ? "Enter your password" : "Create a password"} value={password} onKeyDown={checkCapsLock} onKeyUp={checkCapsLock} onBlur={() => setCapsLock(false)} onChange={(event) => { setPassword(event.target.value); setPasswordError(null); setError(null); }} /><button type="button" disabled={busy} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPassword(!showPassword)} className="absolute right-0.5 top-0.5 flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div>
                {passwordError && <p id="password-error" role="alert" className="text-xs text-destructive">{passwordError}</p>}
                {capsLock && <p id="caps-lock" role="status" className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><CircleAlert className="size-3.5" /> Caps Lock is on</p>}
                {mode === "signup" && <div id="password-hint" className="space-y-2.5 pt-1"><p className={`flex items-center gap-1.5 text-xs ${password.length >= 6 ? "text-teal-700 dark:text-teal-300" : "text-muted-foreground"}`}>{password.length >= 6 ? <CheckCircle2 className="size-3.5" /> : <span className="size-3.5 rounded-full border border-current opacity-40" />} At least 6 characters</p><p className="text-xs leading-5 text-muted-foreground">A longer, unique password is even better.</p></div>}
              </div>
              {error && <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" /><p>{error}</p></div>}
              <Button type="submit" className="group h-12 w-full rounded-xl text-sm shadow-sm motion-safe:active:scale-[0.99]" disabled={busy}>{busy ? <><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{navigating ? "Opening your workspace…" : mode === "signin" ? "Signing you in…" : "Creating your account…"}</> : <>{mode === "signin" ? "Sign in to your workspace" : "Create your account"}<ArrowRight className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5" /></>}</Button>
              <p className="sr-only" role="status">{busy ? navigating ? "Opening your workspace" : "Please wait while we check your details" : ""}</p>
            </form>
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-3.5 text-teal-600" /> Your workspace. Your relationships. Your momentum.</p>
        </>}
        <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground lg:hidden"><Sparkles className="size-3.5 text-primary" /> Small touches. Real momentum.</div>
      </div>
      <p className="mt-6 text-center text-[11px] text-muted-foreground/70">Outreach Relationship Management System</p>
    </section>
  </main>;
}
