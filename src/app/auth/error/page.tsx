import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeReturnPath } from "@/lib/workspace";

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ next?: string; kind?: string }> }) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const recovery = params.kind === "recovery";
  return <main className="grid min-h-svh place-items-center bg-background p-5">
    <div className="w-full max-w-md space-y-5 rounded-3xl border bg-card p-6 shadow-sm sm:p-9">
      <CircleAlert className="size-10 text-primary" aria-hidden="true" />
      <h1 className="text-2xl font-semibold">{recovery ? "Try a fresh reset link." : "Let’s finish signing you in."}</h1>
      <p className="text-sm leading-6 text-muted-foreground">{recovery ? "This password reset link has expired or could not be verified. Request a new link and open it in the same browser." : "This email link has expired, was already used, or was opened in another browser. If you confirmed your email, sign in to continue."}{!recovery && next.startsWith("/join/") && " You can return to your invitation after signing in."}</p>
      <Button asChild className="min-h-12 w-full"><Link href={recovery ? "/login/forgot-password?error=invalid_link" : `/login?next=${encodeURIComponent(next)}`}>{recovery ? "Request a new reset link" : "Sign in to continue"}</Link></Button>
    </div>
  </main>;
}
