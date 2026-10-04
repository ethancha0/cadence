"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { resetLocalDemo } from "@/lib/backend";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const { ready, mode, settings, updateSettings, reload, live } = useStore();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "supabase") return;
    void createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, [mode]);

  if (!ready) return <p className="text-muted">Loading…</p>;

  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <>
      <header className="page-header tight">
        <h1 className="page-title">Settings</h1>
      </header>

      <div className="stack" style={{ maxWidth: 620 }}>
        <section>
          <h6>Hard stop</h6>
          <p className="text-muted small">When a block ends, require a pro or a delta before you can move on.</p>
          <div className="seg" role="radiogroup" aria-label="Require a note at hard stop">
            <label className="seg-opt">
              <input type="radio" name="req" checked={settings.requireNotes} onChange={() => updateSettings({ ...settings, requireNotes: true })} />
              Required
            </label>
            <label className="seg-opt">
              <input type="radio" name="req" checked={!settings.requireNotes} onChange={() => updateSettings({ ...settings, requireNotes: false })} />
              Optional
            </label>
          </div>
        </section>

        <section>
          <h6>Account</h6>
          {mode === "supabase" ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <span className="small">Signed in as {email ?? "…"}</span>
              <button className="btn btn-secondary" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : (
            <>
              <p className="small">
                Local demo mode: there&apos;s no sign-in, and your data lives only in this browser. Add your Supabase URL and key to <code>.env.local</code> to
                switch to the real backend (see the README).
              </p>
              <button
                className="btn btn-secondary"
                disabled={Boolean(live)}
                onClick={async () => {
                  resetLocalDemo();
                  await reload();
                  router.push("/");
                }}
              >
                Reset demo data
              </button>
            </>
          )}
        </section>
      </div>
    </>
  );
}
