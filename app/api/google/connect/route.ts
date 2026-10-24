import { NextResponse, type NextRequest } from "next/server";
import { authUrl, googleConfigured, STATE_COOKIE, STATE_PATH } from "@/lib/google";
import { supabaseConfigured } from "@/lib/supabase/client";

// GET /api/google/connect — Settings' "Connect Google Calendar" link. Sends the browser to Google's consent screen,
// which comes back to /api/google/callback.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!supabaseConfigured || !googleConfigured) return NextResponse.redirect(new URL("/settings?google=unconfigured", origin));

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(origin, state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", maxAge: 600, path: STATE_PATH });
  return res;
}
