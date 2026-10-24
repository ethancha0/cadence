// Runs in the overlay window only. Exposes what components/DesktopOverlay.tsx needs from the shell.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cadenceDesktop", {
  shortcut: process.platform === "darwin" ? "⌥⌘K" : "Ctrl+Alt+K",
  setInteractive: (on) => ipcRenderer.send("overlay:interactive", Boolean(on)),
  setGlass: (on) => ipcRenderer.send("overlay:glass", Boolean(on)),
  resize: (height) => ipcRenderer.send("overlay:resize", Number(height)),
  open: (path) => ipcRenderer.send("overlay:open", String(path)),
});
