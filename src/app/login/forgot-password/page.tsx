"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, MailCheck } from "lucide-react";

function ForgotPasswordForm() {
  const supabase = createClient();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "invalid_link"
      ? "That reset link has expired or was already used. Request a new one below."
      : null
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirm?next=/login/update-password`,
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Always report success, even for an unknown address — telling a stranger
    // whether an account exists would leak who our users are.
    setSent(true);
  }

  if (sent) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            <MailCheck className="h-6 w-6" /> Check your email
          </CardTitle>
          <CardDescription>
            If an account exists for <strong>{email}</strong>, a reset link is on its way.
            The link expires in one hour.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Nothing arrived? Check spam, then try again in a few minutes.
          </p>
          <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
            Use a different email
          </Button>
          <Button variant="ghost" className="w-full" asChild>
            <Link href="/login">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to sign in
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a link to choose a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </Button>
          <Button variant="ghost" className="w-full" asChild>
            <Link href="/login">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to sign in
            </Link>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Suspense fallback={null}>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}
