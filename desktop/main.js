// Cadence desktop shell. Shows /overlay in a transparent, always-on-top window in the
// top-right corner of the screen, and the full app in an ordinary window. Both load the
// Next app at CADENCE_URL and share one browser session, so sign-in and demo-mode data
// are shared between them.
import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = new URL(process.env.CADENCE_URL ?? "http://localhost:3000");
const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth"];
const WIDTH = 320;
const MARGIN = 10; // gap to the screen edges
const SHORTCUT = "CommandOrControl+Alt+K";
const isMac = process.platform === "darwin";
const tone = process.env.CADENCE_OVERLAY_TONE === "light" ? "light" : "dark";
const here = path.dirname(fileURLToPath(import.meta.url));

let overlay = null;
let main = null;
let hiddenByUser = false;
let waitingForSignIn = false;

function overlayUrl() {
  const url = new URL("/overlay", BASE);
  url.searchParams.set("tone", tone);
  if (process.env.CADENCE_OVERLAY_OPACITY) url.searchParams.set("opacity", process.env.CADENCE_OVERLAY_OPACITY);
  if (process.env.CADENCE_OVERLAY_REST) url.searchParams.set("rest", process.env.CADENCE_OVERLAY_REST);
  return url.href;
}

const isAppUrl = (url) => {
  try {
    return new URL(url).origin === BASE.origin;
  } catch {
    return false;
  }
};

const pathOf = (url) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

function topRight(height) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WIDTH - MARGIN,
    y: workArea.y + MARGIN,
    width: WIDTH,
    height: Math.max(40, Math.min(height, workArea.height - 2 * MARGIN)),
  };
}

/** Windows only ever show the Cadence app; other links open in the default browser. */
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) openMain(pathOf(url));
    else if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...topRight(120),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    // A non-activating panel: clicking it doesn't pull focus away from the app you're working in.
    ...(isMac ? { type: "panel" } : {}),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required", // the block-end chime
    },
  });
  overlay.setAlwaysOnTop(true, "floating");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through until the page reports the pointer is over the panel (see overlay:interactive).
  overlay.setIgnoreMouseEvents(true, { forward: true });
  guard(overlay);

  overlay.webContents.on("did-navigate", (_e, url) => {
    if (new URL(url).pathname === "/overlay") return;
    // Signed out, so the app redirected to /login. Sign in in the main window; the overlay comes back after.
    waitingForSignIn = true;
    overlay.hide();
    openMain("/login");
  });
  overlay.webContents.on("did-finish-load", () => {
    if (new URL(overlay.webContents.getURL()).pathname === "/overlay" && !hiddenByUser) overlay.showInactive();
  });
  overlay.webContents.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    // -3 is an aborted load (a redirect). Anything else is most likely the dev server not being up yet.
    if (isMainFrame && code !== -3) setTimeout(() => overlay?.loadURL(overlayUrl()), 3000);
  });
  overlay.on("closed", () => (overlay = null));
  void overlay.loadURL(overlayUrl());
}

/** Shows the full app, navigating to `p` when given. */
function openMain(p) {
  if (main) {
    if (p) void main.loadURL(new URL(p, BASE).href);
    main.show();
    main.focus();
    return;
  }
  main = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#f3f2f2",
    webPreferences: { contextIsolation: true, sandbox: true, autoplayPolicy: "no-user-gesture-required" },
  });
  guard(main);
  const onPage = (_e, url) => {
    if (!waitingForSignIn || AUTH_PATHS.some((a) => new URL(url).pathname.startsWith(a))) return;
    waitingForSignIn = false;
    void overlay?.loadURL(overlayUrl());
  };
  main.webContents.on("did-navigate", onPage);
  main.webContents.on("did-navigate-in-page", onPage);
  main.on("closed", () => (main = null));
  void main.loadURL(new URL(p ?? "/", BASE).href);
}

function toggleOverlay() {
  if (!overlay) return createOverlay();
  hiddenByUser = !hiddenByUser;
  if (hiddenByUser) overlay.hide();
  else overlay.showInactive();
}

// ---------- messages from the overlay page (desktop/preload.cjs) ----------

const fromOverlay = (e) => overlay !== null && e.sender === overlay.webContents;

ipcMain.on("overlay:interactive", (e, on) => {
  if (fromOverlay(e)) overlay.setIgnoreMouseEvents(!on, { forward: true });
});

// Solid (hovered, or at a hard stop): blur what's behind with the native material. At rest: just a faint tint.
ipcMain.on("overlay:glass", (e, on) => {
  if (!fromOverlay(e)) return;
  if (isMac) overlay.setVibrancy(on ? (tone === "light" ? "popover" : "hud") : null);
  overlay.setHasShadow(Boolean(on));
});

ipcMain.on("overlay:resize", (e, height) => {
  if (fromOverlay(e) && Number.isFinite(height)) overlay.setBounds(topRight(Math.ceil(height)));
});

ipcMain.on("overlay:open", (e, p) => {
  if (fromOverlay(e) && typeof p === "string" && p.startsWith("/") && !p.startsWith("//")) openMain(p);
});

// ---------- app ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createOverlay();
    if (!globalShortcut.register(SHORTCUT, toggleOverlay)) console.warn(`Couldn't register ${SHORTCUT}; another app has it.`);
    app.on("activate", () => openMain());
    app.on("second-instance", () => openMain());
  });
}

// The overlay stays up when the main window closes; quit from the Dock or the app menu.
app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
