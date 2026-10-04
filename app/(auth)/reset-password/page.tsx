"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase/client";

// Reached from the reset email via /auth/callback, which signs the user in first.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else router.push("/");
  };

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="password">New password</label>
          <input id="password" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="msg err">{error}</p>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
          Save password
        </button>
      </form>
    </AuthShell>
  );
}
