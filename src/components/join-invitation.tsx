"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type Preview = { workspace_name: string; email?: string; workspace_id?: string; already_joined?: boolean; campaigns?: { name: string; role: string }[] };
export function JoinInvitation({ token, email, preview }: { token: string; email: string | null; preview: Preview | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const login = `/login?next=${encodeURIComponent(`/join/${token}`)}`;
  const wrongAccount = Boolean(email && preview?.email && email.toLowerCase() !== preview.email.toLowerCase());
  async function accept() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { data, error } = await createClient().rpc("orms_accept_invitation", { p_token: token });
      if (error) throw error;
      router.replace(`/w/${data}/campaigns`); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : (error as { message?: string }).message ?? "Could not accept the invitation."); setBusy(false); }
  }
  async function switchAccount() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      location.assign(login);
    } catch { setError("Could not switch accounts. Please try again."); setBusy(false); }
  }
  return <main className="flex min-h-svh items-center justify-center bg-background p-5"><div className="w-full max-w-md space-y-5 rounded-3xl border bg-card p-6 shadow-sm sm:p-9"><ShieldCheck className="size-10 text-primary" /><p className="text-xs font-semibold uppercase tracking-widest text-primary">ORMS team invitation</p>
    {!preview ? <><h1 className="text-3xl font-semibold">Invitation unavailable.</h1><p className="text-sm leading-6 text-muted-foreground">This invitation has expired, was revoked, or has already been used. Ask the workspace owner for a new invitation.</p><Button asChild className="min-h-11 w-full"><Link href={email ? "/workspaces" : "/login"}>{email ? "Your workspaces" : "Sign in"}</Link></Button></> : <>
      <h1 className="break-words text-3xl font-semibold">Join {preview.workspace_name}.</h1>
      {preview.already_joined ? <><p className="text-sm text-muted-foreground">You already joined this workspace.</p><Button asChild className="min-h-11 w-full"><Link href={`/w/${preview.workspace_id}/campaigns`}>Open workspace <ArrowRight className="size-4" /></Link></Button></> : <>
        <p className="text-sm leading-6 text-muted-foreground">Invited as <strong className="break-all">{preview.email}</strong>. Your existing workspaces stay separate.</p>
        <ul className="space-y-2 rounded-xl border p-3 text-sm">{preview.campaigns?.map((campaign, index) => <li key={index} className="flex flex-wrap justify-between gap-2"><span className="min-w-0 break-words">{campaign.name}</span><span className="capitalize text-muted-foreground">{campaign.role}</span></li>)}</ul>
        {email ? <><p className="break-all text-sm">Signed in as <strong>{email}</strong></p>{wrongAccount ? <p role="alert" className="break-words text-sm text-destructive">Use <span className="break-all">{preview.email}</span> to accept this invitation.</p> : <Button className="min-h-12 w-full" disabled={busy} onClick={accept}>{busy ? "Joining your team…" : "Accept invitation"}<ArrowRight className="size-4" /></Button>}<Button variant="ghost" className="min-h-11 w-full" disabled={busy} onClick={switchAccount}>Use another account</Button></> : <Button className="min-h-12 w-full" asChild><Link href={login}>Sign in or create an account <ArrowRight className="size-4" /></Link></Button>}
        <p className="text-xs leading-5 text-muted-foreground">Only the matching verified email can accept. Invitations expire after seven days and can be used once.</p>
      </>}
    </>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div></main>;
}
