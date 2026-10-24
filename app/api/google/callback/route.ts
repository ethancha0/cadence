import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, expiresAt, GoogleError, hasScopes, listCalendars, missingTable, revoke, STATE_COOKIE, STATE_PATH } from "@/lib/google";
import { createClient } from "@/lib/supabase/server";

// GET /api/google/callback — where Google's consent screen returns. Stores the grant and goes back to
// /settings?google=<result>; Settings then imports the account's calendars into day_settings.calendars.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`/settings?google=${result}`, url.origin));
    res.cookies.set(STATE_COOKIE, "", { path: STATE_PATH, maxAge: 0 });
    return res;
  };

  const state = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || state !== url.searchParams.get("state")) return back("expired");
  const code = url.searchParams.get("code");
  if (!code) return back("denied"); // Cancel on Google's screen comes back with ?error=access_denied

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return back("error");

  try {
    const t = await exchangeCode(code, url.origin);
    if (!hasScopes(t)) {
      await revoke(t.access_token);
      return back("scopes");
    }
    if (!t.refresh_token) return back("error");
    const calendars = await listCalendars(t.access_token);
    const { error } = await supabase.from("google_connections").upsert({
      user_id: auth.claims.sub,
      email: calendars.find((c) => c.primary)?.id ?? "Google account",
      refresh_token: t.refresh_token,
      access_token: t.access_token,
      access_expires: expiresAt(t),
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error("google_connections upsert:", error.message);
      return back(missingTable(error) ? "no-table" : "error");
    }
    return back("connected");
  } catch (e) {
    console.error("Google connect:", e);
    return back(e instanceof GoogleError ? e.code : "error");
  }
}
