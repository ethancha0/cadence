"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <AuthShell title="Reset password" sub="We'll email you a link to choose a new password.">
      {sent ? (
        <p className="small">
          If {email} has an account, a reset link is on its way. <Link href="/login">Back to sign in</Link>
        </p>
      ) : (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p className="msg err">{error}</p>}
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
            Send reset link
          </button>
          <p className="msg">
            <Link href="/login">Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
