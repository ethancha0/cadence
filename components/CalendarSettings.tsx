"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CAL_COLOR_LABEL, CAL_COLORS, isGoogleIcalUrl, maskIcalUrl } from "@/lib/calendar";
import { DEMO_CALENDARS } from "@/lib/demo-calendar";
import { useStore } from "@/lib/store";
import type { CalColor, CalendarFeed } from "@/lib/types";
import { useGoogleCalendar } from "@/lib/useGoogleCalendar";

function ColorPick({ name, value, onChange }: { name: string; value: CalColor; onChange: (c: CalColor) => void }) {
  return (
    <div className="color-pick" role="radiogroup" aria-label="Colour">
      {CAL_COLORS.map((c) => (
        <label key={c} title={CAL_COLOR_LABEL[c]}>
          <input type="radio" name={name} checked={value === c} onChange={() => onChange(c)} aria-label={CAL_COLOR_LABEL[c]} />
          <span style={{ background: `var(--cal-${c}-bg)`, boxShadow: `inset 0 0 0 2px var(--cal-${c}-sw)` }} />
        </label>
      ))}
    </div>
  );
}

/** What /api/google/callback reports back in ?google=. */
const CONNECT_RESULT: Record<string, { text: string; bad?: boolean }> = {
  connected: { text: "Google Calendar is connected. Every calendar in the account now shows on the Week page." },
  denied: { text: "Google Calendar wasn't connected: the request was cancelled on Google's screen.", bad: true },
  scopes: { text: "Cadence needs both permissions Google asks for, your list of calendars and their events. Connect again and leave both ticked.", bad: true },
  expired: { text: "That sign-in took too long or was started in another tab. Try again.", bad: true },
  "no-table": { text: "Run supabase/google.sql in the Supabase SQL editor, then connect again.", bad: true },
  "api-off": {
    text: "Google turned Cadence away: the Google Calendar API is off in your Google Cloud project. Enable it (APIs & Services → Library → Google Calendar API, in the same project as the OAuth client), wait a minute, then connect again.",
    bad: true,
  },
  client: { text: "Google didn't accept GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Copy them again from Google Auth Platform → Clients and restart the dev server.", bad: true },
  unconfigured: { text: "Google sign-in isn't set up yet: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing on the server (see the README).", bad: true },
  error: { text: "Google Calendar couldn't be connected. Try again; the server log has the details.", bad: true },
};

/** Connect Google Calendar: every calendar in the account is imported, with an on/off switch and a colour each. */
function GoogleCalendars({ feeds, save }: { feeds: CalendarFeed[]; save: (calendars: CalendarFeed[]) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const [result] = useState(() => CONNECT_RESULT[params.get("google") ?? ""] ?? null);
  const { status, refresh, disconnect } = useGoogleCalendar();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const google = feeds.filter((f) => f.google);

  // The result has been read: drop ?google= so a reload doesn't show it again.
  useEffect(() => {
    if (params.get("google")) router.replace("/settings", { scroll: false });
  }, [params, router]);

  const onDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const problem = error ?? status?.error;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      {result && (
        <p className="small" style={{ margin: 0, color: result.bad ? "var(--color-accent-700)" : undefined }}>
          {result.text}
        </p>
      )}
      {!status ? (
        <p className="text-muted small" style={{ margin: 0 }}>
          Checking Google Calendar…
        </p>
      ) : !status.configured ? (
        <p className="text-muted small" style={{ margin: 0 }}>
          To connect Google Calendar in one click, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server (see the README). Until then, add
          calendars by their iCal address below.
        </p>
      ) : !status.email ? (
        <div>
          <a className="btn btn-primary" href="/api/google/connect">
            Connect Google Calendar
          </a>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <span className="small">Google Calendar: {status.email}</span>
            <button className="btn btn-secondary" onClick={onDisconnect} disabled={busy}>
              Disconnect
            </button>
          </div>
          {google.map((f) => (
            <div key={f.id} className="cal-feed" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <label className="cal-toggle">
                  <input type="checkbox" checked={!f.off} onChange={() => save(feeds.map((x) => (x.id === f.id ? { ...x, off: !x.off } : x)))} />
                  <span className="cal-swatch" style={{ background: `var(--cal-${f.color}-bg)`, boxShadow: `inset 0 0 0 1.5px var(--cal-${f.color}-sw)` }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                </label>
                {!f.off && <ColorPick name={`color-${f.id}`} value={f.color} onChange={(c) => save(feeds.map((x) => (x.id === f.id ? { ...x, color: c } : x)))} />}
              </div>
            </div>
          ))}
        </>
      )}
      {problem && (
        <p className="xsmall" style={{ margin: 0, color: "var(--color-accent-700)" }}>
          {problem}{" "}
          {status?.email ? (
            <a href="/api/google/connect">Reconnect</a>
          ) : (
            <button className="btn btn-ghost xsmall" onClick={refresh}>
              Try again
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Settings → Calendars and Your day. Calendars come from the connected Google account or from secret iCal addresses, read by /api/calendar. */
export function CalendarSettings() {
  const { mode, daySettings, updateDaySettings } = useStore();
  const feeds = daySettings.calendars;
  const used = new Set(feeds.map((f) => f.color));
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState<CalColor | null>(null);
  const pick = color ?? CAL_COLORS.find((c) => !used.has(c)) ?? "slate";
  const urlOk = isGoogleIcalUrl(url);
  const canAdd = Boolean(name.trim()) && urlOk && !feeds.some((f) => f.url === url.trim());

  const save = (calendars: CalendarFeed[]) => updateDaySettings({ ...daySettings, calendars });
  const add = () => {
    if (!canAdd) return;
    void save([...feeds, { id: crypto.randomUUID(), name: name.trim(), url: url.trim(), color: pick }]);
    setName("");
    setUrl("");
    setColor(null);
  };

  return (
    <>
      <section>
        <h6>Calendars</h6>
        <p className="text-muted small">
          Events from your calendars show in colour on the Week page. Cadence only reads them and never changes your calendar.
        </p>
        {mode === "local" ? (
          <>
            <p className="small">Demo mode shows sample calendars instead. Connecting real ones needs Supabase (see the README).</p>
            {DEMO_CALENDARS.map((f) => (
              <div key={f.id} className="cal-feed">
                <span className="cal-swatch" style={{ background: `var(--cal-${f.color}-bg)`, boxShadow: `inset 0 0 0 1.5px var(--cal-${f.color}-sw)` }} />
                <span className="small">{f.name}</span>
                <span />
              </div>
            ))}
          </>
        ) : (
          <>
            <GoogleCalendars feeds={feeds} save={(c) => void save(c)} />
            {feeds.some((f) => !f.google) && <p className="text-muted xsmall" style={{ margin: 0 }}>By iCal address</p>}
            {feeds.filter((f) => !f.google).map((f) => (
              <div key={f.id} className="cal-feed" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <span className="small">{f.name}</span>
                  <span className="text-muted xsmall" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {maskIcalUrl(f.url)}
                  </span>
                  <ColorPick name={`color-${f.id}`} value={f.color} onChange={(c) => void save(feeds.map((x) => (x.id === f.id ? { ...x, color: c } : x)))} />
                </div>
                <button className="btn btn-ghost" onClick={() => void save(feeds.filter((x) => x.id !== f.id))}>
                  Remove
                </button>
              </div>
            ))}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: "var(--space-3)" }}>
                <div className="field">
                  <label htmlFor="cal-name">Name</label>
                  <input id="cal-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Classes" />
                </div>
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label htmlFor="cal-url">Secret address in iCal format</label>
                  <input
                    id="cal-url"
                    className="input"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && add()}
                    placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                  />
                </div>
              </div>
              {url.trim() && !urlOk && (
                <p className="xsmall" style={{ color: "var(--color-accent-700)", margin: 0 }}>
                  That isn&apos;t a Google Calendar iCal address. It should start with https://calendar.google.com/calendar/ical/ and end in .ics.
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)" }}>
                <ColorPick name="color-new" value={pick} onChange={setColor} />
                <button className="btn btn-primary" onClick={add} disabled={!canAdd}>
                  Add calendar
                </button>
              </div>
              <details className="small">
                <summary style={{ cursor: "pointer", color: "var(--color-accent-700)" }}>Where do I find this?</summary>
                <p className="text-muted" style={{ marginTop: "var(--space-2)" }}>
                  In Google Calendar on the web: Settings › pick the calendar under &ldquo;Settings for my calendars&rdquo; › Integrate calendar › Secret
                  address in iCal format. Anyone with this address can see that calendar, so treat it like a password. Resetting it in Google breaks the
                  link here too.
                </p>
              </details>
            </div>
          </>
        )}
      </section>

      <section>
        <h6>Your day</h6>
        <p className="text-muted small">The Week page shows these hours.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)" }}>
          <div className="field">
            <label htmlFor="day-start">Day starts</label>
            <input
              id="day-start"
              className="input"
              type="time"
              step={3600}
              value={daySettings.day_start}
              onChange={(e) => e.target.value && e.target.value < daySettings.wind_down && void updateDaySettings({ ...daySettings, day_start: e.target.value })}
              style={{ width: 140 }}
            />
          </div>
          <div className="field">
            <label htmlFor="wind-down">Wind-down</label>
            <input
              id="wind-down"
              className="input"
              type="time"
              step={3600}
              value={daySettings.wind_down}
              onChange={(e) => e.target.value && e.target.value > daySettings.day_start && void updateDaySettings({ ...daySettings, wind_down: e.target.value })}
              style={{ width: 140 }}
            />
          </div>
        </div>
      </section>
    </>
  );
}
