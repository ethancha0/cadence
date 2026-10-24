// Server-only: Google Calendar over OAuth (Settings → Connect Google Calendar).
// Read-only scopes: Cadence lists your calendars and reads event titles and times, and never writes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalEvent } from "./types";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

/** Without both env vars Settings hides the Connect button and the iCal addresses still work. */
export const googleConfigured = Boolean(CLIENT_ID && CLIENT_SECRET);

const SCOPES = ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.readonly"];
const API = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 10_000;

/** CSRF check for the round trip through Google: a random value in a cookie and in `state`. */
export const STATE_COOKIE = "cadence_google_state";
export const STATE_PATH = "/api/google";

/** Message is safe to show the user. `code` is the ?google= result /api/google/callback reports for it. */
export class GoogleError extends Error {
  constructor(message: string, readonly code = "error") {
    super(message);
  }
}

export const errorMessage = (e: unknown) =>
  e instanceof GoogleError ? e.message : e instanceof Error && e.name === "TimeoutError" ? "Google timed out" : "Couldn't reach Google";

// ---------- OAuth ----------

/** Must match an "Authorized redirect URI" on the OAuth client in Google Cloud exactly. */
const redirectUri = (origin: string) => `${origin}/api/google/callback`;

export function authUrl(origin: string, state: string): string {
  return (
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(origin),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline", // a refresh token, so the Week page keeps working after the first hour
      prompt: "consent", // Google only sends a refresh token on the consent screen, and reconnecting needs a new one
      state,
    })
  );
}

interface Tokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function token(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body as Tokens;
  if (body.error === "invalid_client") throw new GoogleError("Google didn't accept GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", "client");
  if (body.error === "invalid_grant") throw new GoogleError("Google access was revoked or has expired. Reconnect in Settings.");
  throw new GoogleError(`Google refused the sign-in (${body.error ?? res.status})`);
}

export const exchangeCode = (code: string, origin: string) => token({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });

/** Google's consent screen lets people untick scopes. Cadence needs both. */
export const hasScopes = (t: Tokens) => SCOPES.every((s) => t.scope?.split(" ").includes(s));

export const expiresAt = (t: Tokens) => new Date(Date.now() + t.expires_in * 1000).toISOString();

/** Revoking either token ends the whole grant, so Cadence disappears from the account's third-party access list. */
export async function revoke(tok: string) {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: tok }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {});
}

// ---------- the stored connection ----------

export interface Connection {
  user_id: string;
  email: string;
  refresh_token: string;
  access_token: string | null;
  access_expires: string | null;
}

/** The signed-in user's connection (RLS picks the row), or null when they haven't connected. */
export async function getConnection(sb: SupabaseClient): Promise<Connection | null> {
  const { data, error } = await sb.from("google_connections").select("*").maybeSingle();
  if (error) throw new GoogleError(missingTable(error) ? "Run supabase/google.sql in the Supabase SQL editor first." : error.message);
  return data;
}

/** Postgres's "undefined table", or PostgREST's "not in the schema cache". */
export const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

/** A live access token, refreshed and cached in the row when the stored one is about to expire. */
export async function accessToken(sb: SupabaseClient, c: Connection): Promise<string> {
  if (c.access_token && c.access_expires && Date.parse(c.access_expires) - Date.now() > 60_000) return c.access_token;
  const t = await token({ grant_type: "refresh_token", refresh_token: c.refresh_token });
  await sb.from("google_connections").update({ access_token: t.access_token, access_expires: expiresAt(t) }).eq("user_id", c.user_id);
  return t.access_token;
}

// ---------- Calendar API ----------

async function get<T>(tok: string, path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${tok}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.ok) return res.json();
  if (res.status === 401) throw new GoogleError("Google access was revoked. Reconnect in Settings.");
  if (res.status === 404) throw new GoogleError("This calendar is no longer in your Google account");
  const body = await res.text().catch(() => "");
  // The Calendar API has to be enabled in the Cloud project that owns the OAuth client.
  if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/.test(body)) {
    throw new GoogleError("The Google Calendar API is turned off in your Google Cloud project. Enable it, then connect again.", "api-off");
  }
  console.error(`Google ${res.status} on ${path}:`, body.slice(0, 500));
  throw new GoogleError(`Google answered ${res.status}`);
}

/** Every page of a list endpoint. */
async function all<T>(tok: string, path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await get<{ items?: T[]; nextPageToken?: string }>(tok, path, { ...params, ...(pageToken && { pageToken }) });
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export interface GoogleCalendar {
  id: string;
  name: string;
  primary: boolean;
}

/** The calendars in the account's Google Calendar sidebar, primary first. The primary calendar's id is the account's email. */
export async function listCalendars(tok: string): Promise<GoogleCalendar[]> {
  const items = await all<{ id: string; summary?: string; summaryOverride?: string; primary?: boolean }>(tok, "/users/me/calendarList", {
    maxResults: "250",
    fields: "items(id,summary,summaryOverride,primary),nextPageToken",
  });
  return items
    .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary) }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

interface GoogleEvent {
  id: string;
  summary?: string;
  status?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/**
 * One calendar's events overlapping [from, to), recurring ones expanded by Google.
 * Skips the same events as lib/ical.ts (cancelled, or marked "free"), plus invitations you declined.
 */
export async function calendarEvents(tok: string, googleId: string, feedId: string, from: Date, to: Date): Promise<CalEvent[]> {
  const items = await all<GoogleEvent>(tok, `/calendars/${encodeURIComponent(googleId)}/events`, {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    maxResults: "2500",
    fields: "items(id,summary,status,transparency,start,end,attendees(self,responseStatus)),nextPageToken",
  });
  const out: CalEvent[] = [];
  for (const e of items) {
    if (e.status === "cancelled" || e.transparency === "transparent") continue;
    if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
    const allDay = Boolean(e.start?.date);
    const start = allDay ? e.start?.date : e.start?.dateTime;
    const end = allDay ? e.end?.date : e.end?.dateTime;
    if (!start || !end) continue;
    out.push({
      id: `${feedId}:${e.id}`,
      calendar: feedId,
      title: e.summary || "(No title)",
      start: allDay ? start : new Date(start).toISOString(), // all-day: YYYY-MM-DD, end exclusive, like iCal
      end: allDay ? end : new Date(end).toISOString(),
      allDay,
    });
  }
  return out;
}
