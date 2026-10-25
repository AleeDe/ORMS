import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

export async function createClient(workspaceId?: string) {
  const cookieStore = await cookies();
  const routeWorkspace = workspaceId ?? (await headers()).get("x-orms-route-workspace") ?? "";

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { "x-orms-workspace": routeWorkspace } },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a Server Component; proxy refreshes sessions
          }
        },
      },
    }
  );
}
