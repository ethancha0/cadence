"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { chime, notifyPermission, requestNotifyPermission, testNotify, type NotifyPermission, type TestResult } from "@/lib/alerts";
import { resetLocalDemo } from "@/lib/backend";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const { ready, mode, settings, updateSettings, reload, live } = useStore();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotifyPermission>(() => notifyPermission());
  const [test, setTest] = useState<TestResult | "sending" | null>(null);

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

  const sendTest = async () => {
    const p = await requestNotifyPermission();
    setPermission(p);
    chime();
    setTest("sending");
    setTest(await testNotify());
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
          <h6>Notifications</h6>
          <p className="text-muted small">When a block&apos;s timer runs out, Cadence plays a chime and sends a desktop notification.</p>
          <p className="small">
            {permission === "granted" && "Notifications are on for this browser."}
            {permission === "default" && "Not enabled yet. Your browser will ask for permission when you send a test."}
            {permission === "denied" && "Blocked by your browser. Allow notifications for this site in your browser's site settings, then reload."}
            {permission === "unsupported" && "This browser doesn't support desktop notifications."}
          </p>
          <button className="btn btn-secondary" disabled={permission === "denied" || permission === "unsupported" || test === "sending"} onClick={sendTest}>
            Send test notification
          </button>
          {test && test !== "sending" && (
            <p className="text-muted small">
              {test.status === "shown" &&
                "Your browser handed the notification to the system. If no banner appeared, macOS is hiding it: in System Settings → Notifications → your browser, turn on Allow notifications, set the alert style to Banners or Alerts, and make sure Focus / Do Not Disturb is off."}
              {test.status === "error" && "Your browser refused to show the notification. Check this site's notification permission in your browser's site settings."}
              {test.status === "no-response" &&
                "Your browser didn't confirm the notification. In Chrome, check chrome://settings/content/notifications and make sure this site is allowed; then check System Settings → Notifications → your browser on macOS."}
              {test.status === "not-granted" && "Notification permission wasn't granted, so nothing was sent."}
              {test.status === "threw" && `The browser threw an error: ${test.message}`}
            </p>
          )}
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
