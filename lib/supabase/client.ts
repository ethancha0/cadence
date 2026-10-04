import { createBrowserClient } from "@supabase/ssr";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Without Supabase env vars the app runs in local demo mode (localStorage, no sign-in). */
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
