import { shouldHandoffToMacApp } from "../dist/shared/macAppHandoff.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const base = {
  platform: "darwin",
  isPackaged: false,
  execPath: "/tmp/vibe-tree/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  isDev: false,
  isSmokeTest: false,
  terminalRoot: "/tmp/vibe-tree",
};

assert(shouldHandoffToMacApp(base), "a raw macOS release launch should hand off to Vibe Tree.app");
assert(!shouldHandoffToMacApp({ ...base, isPackaged: true }), "the packaged app must not hand off recursively");
assert(
  !shouldHandoffToMacApp({ ...base, execPath: "/tmp/vibe-tree/dist/Vibe Tree.app/Contents/MacOS/Vibe Tree" }),
  "a local app bundle must not hand off recursively",
);
assert(!shouldHandoffToMacApp({ ...base, isDev: true }), "development mode must keep the Electron process");
assert(!shouldHandoffToMacApp({ ...base, isSmokeTest: true }), "smoke tests must not start a second app");
assert(!shouldHandoffToMacApp({ ...base, platform: "win32" }), "Windows startup must remain unchanged");
assert(!shouldHandoffToMacApp({ ...base, terminalRoot: undefined }), "launches outside a source checkout cannot hand off");

console.log("macOS app handoff tests passed");
