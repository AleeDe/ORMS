import { createBrowserClient } from "@supabase/ssr";
import { createClient as createDataClient, type SupabaseClient } from "@supabase/supabase-js";
import { createWorkspaceFetch, workspaceIdFromPath } from "@/lib/workspace";

const clients = new Map<string, SupabaseClient>();

export function createClient(workspaceId?: string) {
  const auth = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const scope = workspaceId ?? (typeof window === "undefined" ? null : workspaceIdFromPath(window.location.pathname));
  if (!scope) return auth;
  const cached = clients.get(scope);
  if (cached) return cached;
  // Share one auth/refresh session while each data client keeps its own scope.
  const data = createDataClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    accessToken: async () => (await auth.auth.getSession()).data.session?.access_token ?? null,
    global: { fetch: createWorkspaceFetch(scope) },
  });
  const client = new Proxy(data, { get(target, key) {
    if (key === "auth") return auth.auth;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  clients.set(scope, client);
  return client;
}
