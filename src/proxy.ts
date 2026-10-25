import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeReturnPath, workspaceIdFromPath, workspacePath, type Workspace } from "@/lib/workspace";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const scope = workspaceIdFromPath(path);
  function next() {
    const headers = new Headers(request.headers);
    headers.delete("x-orms-route-workspace");
    if (scope) headers.set("x-orms-route-workspace", scope);
    return NextResponse.next({ request: { headers } });
  }
  let response = next();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  function redirect(url: URL) {
    const redirected = NextResponse.redirect(url);
    response.cookies.getAll().forEach(cookie => redirected.cookies.set(cookie));
    return redirected;
  }
  const { data: { user } } = await supabase.auth.getUser();
  const publicRoute = path.startsWith("/login") || path.startsWith("/auth/confirm") || path === "/auth/error" || path.startsWith("/join/") || path === "/api/google/callback";
  if (!user && !publicRoute) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const login = new URL("/login", request.url);
    login.searchParams.set("next", safeReturnPath(path + request.nextUrl.search));
    return redirect(login);
  }
  if (!user && path.startsWith("/login/update-password")) {
    return redirect(new URL("/login/forgot-password?error=invalid_link", request.url));
  }
  if (user && path.startsWith("/login") && !path.startsWith("/login/update-password")) {
    return redirect(new URL(safeReturnPath(request.nextUrl.searchParams.get("next")), request.url));
  }
  // Upgrade old bookmarks once; explicit workspace URLs never silently fall
  // back to a different organization, even if access has been revoked.
  const legacy = /^\/(?:datasets|leads|people|campaigns|tasks|analytics|team|notifications|settings|help)(?:\/|$)/.test(path) || path === "/";
  if (user && legacy) {
    const { data, error } = await supabase.rpc("orms_workspaces");
    if (error) return redirect(new URL("/workspaces", request.url));
    const choices = data as Workspace[];
    const preferred = request.cookies.get("orms_workspace")?.value;
    const campaign = path.match(/^\/campaigns\/([^/]+)$/)?.[1] ?? request.nextUrl.searchParams.get("campaign") ?? request.nextUrl.searchParams.get("from")?.match(/^campaign:(.+)$/)?.[1];
    const linkedWorkspace = campaign ? choices.find(choice => choice.campaigns.some(item => item.id === campaign)) : /^\/leads\/[^/]+$/.test(path) ? choices.find(choice => choice.id === user.id) : undefined;
    const workspace = linkedWorkspace ?? choices.find(choice => choice.id === preferred) ?? choices[0];
    if (!workspace) return redirect(new URL("/workspaces", request.url));
    const target = request.nextUrl.clone();
    target.pathname = `/w/${workspace.id}${path === "/" ? "" : path}`;
    return redirect(target);
  }
  if (scope && workspacePath(path).startsWith("/api/")) return new NextResponse(null, { status: 404 });
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
