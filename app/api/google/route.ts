import { accessToken, errorMessage, getConnection, googleConfigured, listCalendars, revoke } from "@/lib/google";
import { supabaseConfigured } from "@/lib/supabase/client";
import { createClient } from "@/lib/supabase/server";
import type { GoogleStatus } from "@/lib/types";

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ? supabase : null;
}

// GET /api/google — whether Google Calendar is connected, and the account's calendars (ids and names only).
export async function GET() {
  if (!supabaseConfigured) return Response.json({ error: "Google Calendar needs Supabase" }, { status: 404 });
  const supabase = await signedIn();
  if (!supabase) return Response.json({ error: "Signed out" }, { status: 401 });
  if (!googleConfigured) return Response.json({ configured: false, email: null, calendars: [] } satisfies GoogleStatus);

  let email: string | null = null;
  try {
    const conn = await getConnection(supabase);
    if (!conn) return Response.json({ configured: true, email: null, calendars: [] } satisfies GoogleStatus);
    email = conn.email;
    const calendars = await listCalendars(await accessToken(supabase, conn));
    return Response.json({ configured: true, email, calendars: calendars.map(({ id, name }) => ({ id, name })) } satisfies GoogleStatus);
  } catch (e) {
    return Response.json({ configured: true, email, calendars: [], error: errorMessage(e) } satisfies GoogleStatus);
  }
}

// DELETE /api/google — Settings' Disconnect: revokes the grant at Google and forgets it.
export async function DELETE() {
  if (!supabaseConfigured) return Response.json({ error: "Google Calendar needs Supabase" }, { status: 404 });
  const supabase = await signedIn();
  if (!supabase) return Response.json({ error: "Signed out" }, { status: 401 });

  try {
    const conn = await getConnection(supabase);
    if (conn) {
      await revoke(conn.refresh_token);
      const { error } = await supabase.from("google_connections").delete().eq("user_id", conn.user_id);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
