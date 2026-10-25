import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JoinInvitation } from "@/components/join-invitation";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const supabase = await createClient();
  const [{ data }, preview] = await Promise.all([supabase.auth.getUser(), supabase.rpc("orms_invitation_preview", { p_token: token })]);
  return <JoinInvitation token={token} email={data.user?.email ?? null} preview={preview.data} />;
}
