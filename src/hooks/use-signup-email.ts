"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { existingEmailMessage, isSignupEmail, signupEmailAvailable } from "@/lib/signup-email";

type Result = { email: string; revision: number; status: "available" | "existing" | "error"; message?: string };
export function useSignupEmail(supabase: SupabaseClient, value: string, enabled: boolean) {
  const email = value.trim().toLowerCase();
  const [result, setResult] = useState<Result | null>(null);
  const [revision, setRevision] = useState(0);
  const valid = isSignupEmail(email);
  useEffect(() => {
    if (!enabled || !valid) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const available = await signupEmailAvailable(supabase, email, controller.signal);
        if (!controller.signal.aborted) setResult({ email, revision, status: available ? "available" : "existing" });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ email, revision, status: "error", message: (error as Error).message });
      }
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [supabase, email, enabled, valid, revision]);
  const status = !enabled || !email ? "idle" : !valid ? "invalid" : result?.email === email && result.revision === revision ? result.status : "checking";
  return {
    status,
    message: status === "existing" ? existingEmailMessage : status === "error" ? result?.message : undefined,
    reset: () => setRevision(value => value + 1),
    markExisting: () => setResult({ email, revision, status: "existing" }),
    markError: () => setResult({ email, revision, status: "error", message: "We could not check this email. Please try again." }),
  };
}
