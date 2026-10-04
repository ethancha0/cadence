// Block-end alerts: a short chime and a system notification, when the browser allows.

let audio: AudioContext | null = null;

/** Call from a click handler (e.g. Begin session) so the chime can play later. */
export function primeAlerts() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {}
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission().catch(() => {});
  }
}

export function chime() {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    [659.25, 523.25].forEach((freq, i) => {
      const t0 = ctx.currentTime + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 1.25);
    });
  } catch {}
}

export function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: "cadence-block-end" });
    }
  } catch {}
}
