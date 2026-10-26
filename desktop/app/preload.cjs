/**
 * What the Mac app's shell offers Inroad's own pages: updates, and nothing else. The page stays a plain web
 * page (sandboxed, no Node.js); these calls go to the main process, which answers only Inroad's own origin.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron loads preloads as CommonJS */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("inroadDesktop", {
  updates: {
    get: () => ipcRenderer.invoke("updates:get"),
    check: () => ipcRenderer.invoke("updates:check"),
    install: () => ipcRenderer.invoke("updates:install"),
    setAutoCheck: (on) => ipcRenderer.invoke("updates:auto-check", on === true),
    subscribe: (cb) => {
      const listener = (_event, status) => cb(status);
      ipcRenderer.on("updates:status", listener);
      return () => ipcRenderer.removeListener("updates:status", listener);
    },
  },
});
