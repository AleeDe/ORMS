import { redirect } from "next/navigation";
import { PasswordUpdateForm } from "@/components/password-update-form";
import { isRecoveryToken, passwordResetDestination } from "@/lib/auth-flow";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; next?: string }> }) {
  const params = await searchParams;
  const next = passwordResetDestination(params.next);
  if (!isRecoveryToken(params.token_hash)) redirect(`/auth/error?kind=recovery&next=${encodeURIComponent(next)}`);
  return <PasswordUpdateForm tokenHash={params.token_hash} next={next} />;
}
