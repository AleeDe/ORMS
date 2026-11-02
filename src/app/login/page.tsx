"use client";

import { Suspense, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, CheckCircle2, CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { LoginBrand, LoginShowcase } from "@/components/login-showcase";
import { safeReturnPath } from "@/lib/workspace";
import { SlidingCapsule } from "@/components/ui/sliding-capsule";
import { EmailVerification } from "@/components/email-verification";
import { EmailAlreadyRegisteredError, signUpWithAvailableEmail } from "@/lib/signup-email";
import { useSignupEmail } from "@/hooks/use-signup-email";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeReturnPath(params.get("next"));
  const joining = next.startsWith("/join/");
  const supabase = createClient();
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const signupEmail = useSignupEmail(supabase, email, mode === "signup" && !confirmationEmail);
  const submitting = useRef(false);
  const busy = loading || navigating;

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    signupEmail.reset();
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
    if (busy || submitting.current || (mode === "signup" && signupEmail.status !== "available")) return;
    setError(null);
    const validEmail = validateEmail();
    const passwordMessage = !password ? "Enter your password." : mode === "signup" && password.length < 6 ? "Use at least 6 characters for your password." : null;
    setPasswordError(passwordMessage);
    if (!validEmail || passwordMessage) {
      (validEmail ? passwordInput : emailInput).current?.focus();
      return;
    }
    submitting.current = true;
    setLoading(true);
    try {
      const { data, error: authError } = mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await signUpWithAvailableEmail(supabase, email, password, `${location.origin}/auth/confirm?next=${encodeURIComponent(next)}`);
      if (authError) {
        if (mode === "signup") signupEmail.reset();
        if (authError.code === "email_not_confirmed") { setConfirmationEmail(email.trim().toLowerCase()); setConfirmationSent(false); return; }
        setError(authError.code === "invalid_credentials"
          ? "That email and password don’t match. Check them and try again."
          : authError.name === "AuthRetryableFetchError"
            ? "We couldn’t connect right now. Check your connection and try again."
            : authError.message);
        return;
      }
      if (mode === "signup" && !data.session) {
        setConfirmationEmail(email.trim());
        setConfirmationSent(true);
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
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) { signupEmail.markExisting(); return; }
      if (mode === "signup") signupEmail.markError();
      setError("We couldn’t connect right now. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return <main className="grid min-h-svh bg-background lg:grid-cols-[1.05fr_0.95fr]">
    <LoginShowcase />
    <section aria-label="Access your ORMS workspace" className="flex min-w-0 flex-col px-5 py-7 sm:px-10 lg:px-12 xl:px-20">
      <div className="mb-8 flex items-center justify-between gap-4 lg:hidden"><LoginBrand /><span className="max-w-28 text-right text-xs leading-5 text-muted-foreground">Your outreach workspace</span></div>
      <div className="mx-auto my-auto w-full max-w-[440px] py-4 sm:py-8">
        {confirmationEmail ? <EmailVerification key={confirmationEmail} email={confirmationEmail} next={next} sent={confirmationSent} onBack={() => switchMode("signin")} /> : <>
          <div className="mb-7">
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><span className="size-1.5 rounded-full bg-teal-500" /> {mode === "signin" ? "Your next move starts here" : "A fresh start"}</p>
            <h1 className="text-[2rem] font-semibold leading-tight tracking-tight sm:text-4xl">{joining ? mode === "signin" ? "Sign in to join your team." : "Create your team login." : mode === "signin" ? "Welcome back." : "Create your workspace."}</h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{joining ? "Verify your email, then review and accept your campaign invitation. Your other workspaces stay separate." : mode === "signin" ? "Your leads, campaigns, and next conversations. All in one place." : "Bring your audience together. Make every conversation count."}</p>
          </div>
          <div className="rounded-3xl border border-border/80 bg-card p-5 shadow-[0_8px_40px_-20px_rgba(40,35,100,0.18)] sm:p-7">
            <div role="group" className="group/auth-switch relative isolate mb-7 grid grid-cols-2 gap-1 rounded-xl bg-muted/80 p-1" aria-label="Account access options">
              <SlidingCapsule activeSelector='button[aria-pressed="true"]' itemSelector="button[aria-pressed]" className="rounded-lg bg-card dark:bg-card" />
              {(["signin", "signup"] as const).map((option) => <button key={option} type="button" aria-pressed={mode === option} disabled={busy} onClick={() => { if (mode !== option) switchMode(option); }} className={`relative z-10 min-h-11 whitespace-nowrap rounded-lg px-2 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 group-data-[capsule-ready=true]/auth-switch:bg-transparent! group-data-[capsule-ready=true]/auth-switch:shadow-none! sm:text-sm ${mode === option ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{option === "signin" ? "Sign in" : "Create account"}</button>)}
            </div>
            <form noValidate onSubmit={handleSubmit} className="space-y-5" aria-busy={busy}>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
                <div className="relative"><Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-4 size-4 text-muted-foreground" /><Input ref={emailInput} id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required disabled={busy} aria-invalid={!!emailError || (mode === "signup" && signupEmail.status === "existing")} aria-describedby={[emailError ? "email-error" : "", mode === "signup" ? "signup-email-status" : ""].filter(Boolean).join(" ") || undefined} className="h-12 rounded-xl bg-background/40 pl-11 text-base! placeholder:text-muted-foreground/60" placeholder="you@company.com" value={email} onBlur={validateEmail} onChange={(event) => { setEmail(event.target.value); signupEmail.reset(); setEmailError(null); setError(null); }} /></div>
                {emailError && <p id="email-error" role="alert" className="text-xs text-destructive">{emailError}</p>}
                {mode === "signup" && <div id="signup-email-status" role="status" aria-live="polite" className="text-xs leading-5">
                  {signupEmail.status === "idle" && <p className="text-muted-foreground">Enter a new email address to create an account.</p>}
                  {signupEmail.status === "invalid" && !emailError && <p className="text-muted-foreground">Enter a valid email address to check availability.</p>}
                  {signupEmail.status === "checking" && <p className="flex items-center gap-1.5 text-muted-foreground"><LoaderCircle className="size-3.5 motion-safe:animate-spin" />Checking email availability…</p>}
                  {signupEmail.status === "available" && <p className="flex items-center gap-1.5 text-teal-700 dark:text-teal-300"><CheckCircle2 className="size-3.5" />This email is available.</p>}
                  {signupEmail.status === "existing" && <div className="space-y-1.5"><p className="text-destructive">{signupEmail.message}</p><div className="flex flex-wrap gap-x-4 gap-y-1"><button type="button" className="min-h-8 font-medium text-primary hover:underline" onClick={() => switchMode("signin")}>Sign in instead</button><Link className="inline-flex min-h-8 items-center font-medium text-primary hover:underline" href={`/login/forgot-password?next=${encodeURIComponent(next)}&email=${encodeURIComponent(email.trim().toLowerCase())}`}>Reset password</Link></div></div>}
                  {signupEmail.status === "error" && <div><p className="text-destructive">{signupEmail.message}</p><button type="button" className="min-h-8 font-medium text-primary hover:underline" onClick={signupEmail.reset}>Check again</button></div>}
                </div>}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2"><Label htmlFor="password" className="text-sm font-medium">Password</Label>{mode === "signin" && <Link href={`/login/forgot-password?next=${encodeURIComponent(next)}`} className="inline-flex min-h-7 items-center rounded text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">Forgot password?</Link>}</div>
                <div className="relative"><LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-3.5 top-4 size-4 text-muted-foreground" /><Input ref={passwordInput} id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 6 : undefined} disabled={busy} aria-invalid={!!passwordError} aria-describedby={[passwordError ? "password-error" : "", capsLock ? "caps-lock" : "", mode === "signup" ? "password-hint" : ""].filter(Boolean).join(" ") || undefined} className="h-12 rounded-xl bg-background/40 pl-11 pr-12 text-base! placeholder:text-muted-foreground/60" placeholder={mode === "signin" ? "Enter your password" : "Create a password"} value={password} onKeyDown={checkCapsLock} onKeyUp={checkCapsLock} onBlur={() => setCapsLock(false)} onChange={(event) => { setPassword(event.target.value); setPasswordError(null); setError(null); }} /><button type="button" disabled={busy} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPassword(!showPassword)} className="absolute right-0.5 top-0.5 flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div>
                {passwordError && <p id="password-error" role="alert" className="text-xs text-destructive">{passwordError}</p>}
                {capsLock && <p id="caps-lock" role="status" className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><CircleAlert className="size-3.5" /> Caps Lock is on</p>}
                {mode === "signup" && <div id="password-hint" className="space-y-2.5 pt-1"><p className={`flex items-center gap-1.5 text-xs ${password.length >= 6 ? "text-teal-700 dark:text-teal-300" : "text-muted-foreground"}`}>{password.length >= 6 ? <CheckCircle2 className="size-3.5" /> : <span className="size-3.5 rounded-full border border-current opacity-40" />} At least 6 characters</p><p className="text-xs leading-5 text-muted-foreground">A longer, unique password is even better.</p></div>}
              </div>
              {error && <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" /><p>{error}</p></div>}
              <Button type="submit" className="group h-12 w-full rounded-xl text-sm shadow-sm motion-safe:active:scale-[0.99]" disabled={busy || (mode === "signup" && signupEmail.status !== "available")}>{busy ? <><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{navigating ? "Opening your workspace…" : mode === "signin" ? "Signing you in…" : "Creating your account…"}</> : <>{mode === "signin" ? "Sign in to your workspace" : "Create your account"}<ArrowRight className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5" /></>}</Button>
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

export default function LoginPage() {
  return <Suspense fallback={<div className="grid min-h-svh place-items-center"><p role="status" className="text-sm text-muted-foreground">Loading sign in…</p></div>}><LoginForm /></Suspense>;
}
