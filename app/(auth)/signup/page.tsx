"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  return (
    <AuthShell title="Create account">
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}

function SignupForm() {
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) return setError(error.message);
    if (data.session) window.location.assign(next);
    else setSent(true); // email confirmation is on
  };

  if (sent) return <p className="small">Check {email} for a confirmation link, then sign in.</p>;

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="msg err">{error}</p>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </button>
      <p className="msg">
        Already have one? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
