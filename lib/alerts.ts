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

export type NotifyPermission = NotificationPermission | "unsupported";

export function notifyPermission(): NotifyPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Asks for permission if it hasn't been decided yet; call from a click handler. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** `tag` should be unique per event: a reused tag replaces the old notification without alerting again. */
export function notify(title: string, body: string, tag?: string) {
  try {
    if (notifyPermission() === "granted") new Notification(title, { body, tag });
  } catch {}
}

export type TestResult = { status: "shown" | "error" | "no-response" | "not-granted" } | { status: "threw"; message: string };

/** Like `notify`, but reports what the browser did with the notification instead of failing silently. */
export function testNotify(): Promise<TestResult> {
  return new Promise((resolve) => {
    if (notifyPermission() !== "granted") return resolve({ status: "not-granted" });
    try {
      const n = new Notification("Cadence test notification", {
        body: "Notifications are working. You'll get one like this when a block ends.",
        tag: `cadence-test-${Date.now()}`,
      });
      n.onshow = () => resolve({ status: "shown" });
      n.onerror = () => resolve({ status: "error" });
      setTimeout(() => resolve({ status: "no-response" }), 4000);
    } catch (e) {
      resolve({ status: "threw", message: e instanceof Error ? e.message : String(e) });
    }
  });
}
