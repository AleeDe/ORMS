import { createClient } from "@supabase/supabase-js";

// Service-role client for server-only writes that bypass RLS (e.g. storing Google
// refresh tokens). NEVER import this into client code — it holds full DB access.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
