"use client";

import { useState } from "react";
import { CAL_COLOR_LABEL, CAL_COLORS, isGoogleIcalUrl, maskIcalUrl } from "@/lib/calendar";
import { DEMO_CALENDARS } from "@/lib/demo-calendar";
import { useStore } from "@/lib/store";
import type { CalColor, CalendarFeed } from "@/lib/types";

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

/** Settings → Calendars and Your day. Feeds are Google Calendar's secret iCal addresses, read by /api/calendar. */
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
          Paste each calendar&apos;s secret iCal address. Its events show in colour on the Week page. Cadence only reads them and never changes your calendar.
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
            {feeds.map((f) => (
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
