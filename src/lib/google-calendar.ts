// Server-only Google Calendar helpers. Uses the OAuth2 refresh-token flow with
// plain fetch (no googleapis dependency). All functions here run on the server.
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

export function redirectUri() {
  return `${appUrl()}/api/google/callback`;
}

// The route issues an opaque state and binds it to the account and workspace
// in an HttpOnly cookie. The callback validates both before saving credentials.
export function consentUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // force a refresh_token every time
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  return res.json();
}

// The email of the connected Google account (for display in Settings).
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}

// Returns a valid access token for the user, refreshing (and caching) as needed.
async function getAccessToken(userId: string, workspaceId: string): Promise<{ token: string; calendarId: string } | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("google_calendar_tokens")
    .select("refresh_token, access_token, access_token_expires_at, calendar_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row) return null;

  const stillValid =
    row.access_token &&
    row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() - 60_000 > Date.now();
  if (stillValid) return { token: row.access_token!, calendarId: row.calendar_id };

  const refreshed = await refreshAccessToken(row.refresh_token);
  if (!refreshed.access_token) return null;
  await admin
    .from("google_calendar_tokens")
    .update({
      access_token: refreshed.access_token,
      access_token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("user_id", userId).eq("workspace_id", workspaceId);
  return { token: refreshed.access_token, calendarId: row.calendar_id };
}

export async function userHasCalendar(userId: string, workspaceId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_calendar_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return !!data;
}

export type NewCalendarEvent = {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
};

// Creates the event on the user's calendar. Returns the Google event id, or null
// if the user isn't connected (caller decides whether that's an error).
export async function createCalendarEvent(
  userId: string,
  workspaceId: string,
  ev: NewCalendarEvent
): Promise<{ id: string; htmlLink: string } | null> {
  const auth = await getAccessToken(userId, workspaceId);
  if (!auth) return null;

  const end = ev.end ?? new Date(ev.start.getTime() + 30 * 60 * 1000);
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  const body = ev.allDay
    ? {
        summary: ev.title,
        description: ev.description,
        location: ev.location,
        start: { date: ymd(ev.start) },
        end: { date: ymd(new Date(ev.start.getTime() + 24 * 60 * 60 * 1000)) },
      }
    : {
        summary: ev.title,
        description: ev.description,
        location: ev.location,
        start: { dateTime: ev.start.toISOString() },
        end: { dateTime: end.toISOString() },
      };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      auth.calendarId
    )}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`Google Calendar error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string; htmlLink: string };
  return { id: data.id, htmlLink: data.htmlLink };
}
