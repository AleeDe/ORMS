import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLoginPage = path.startsWith("/login");
  // The recovery link must reach this route while signed out — it is what
  // exchanges the emailed token for a session.
  const isAuthConfirm = path.startsWith("/auth/confirm");
  const isUpdatePassword = path.startsWith("/login/update-password");

  if (!user && !isLoginPage && !isAuthConfirm) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Setting a new password requires the session that /auth/confirm established.
  // Without one the link was never exchanged (expired, reused, or opened
  // directly), so send them to request a fresh one rather than rendering a form
  // whose submit cannot succeed.
  if (!user && isUpdatePassword) {
    const url = request.nextUrl.clone();
    url.pathname = "/login/forgot-password";
    url.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(url);
  }

  // A signed-in user belongs on the app, except on update-password: arriving
  // there from a recovery link means they are already authenticated and still
  // need to set a new password.
  if (user && isLoginPage && !isUpdatePassword) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
