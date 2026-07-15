import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { computeMacBuildFingerprint } from "./macos-package-support.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (process.platform !== "darwin") {
  console.log("macOS package tests skipped on this platform");
  process.exit(0);
}

const root = process.cwd();
const appPath = join(root, "dist/Vibe Tree.app");
const packageScriptPath = join(root, "scripts/package-macos-app.mjs");
const sourceApp = join(root, "node_modules/electron/dist/Electron.app");
const plistPath = join(appPath, "Contents/Info.plist");
const resourcesDir = join(appPath, "Contents/Resources");
const metadata = await import(pathToFileURL(join(root, "dist/shared/appMetadata.js")).href);
const projectPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const appPackage = JSON.parse(readFileSync(join(resourcesDir, "app/package.json"), "utf8"));
const buildMarker = JSON.parse(readFileSync(join(resourcesDir, "vibe-tree-build.json"), "utf8"));
const packagedMetadata = readFileSync(join(resourcesDir, "app/shared/appMetadata.js"), "utf8");
const menuBarHelperSource = join(root, "src/native/macosMenuBarHelper.swift");
const menuBarHelperPath = join(resourcesDir, "bin/vibe-tree-menu-bar-helper");
const plistBuddy = "/usr/libexec/PlistBuddy";
const plistValue = (key) =>
  execFileSync(plistBuddy, ["-c", `Print :${key}`, plistPath], { encoding: "utf8" }).trim();

assert(existsSync(appPath), "Vibe Tree.app should exist");
assert(plistValue("CFBundleIdentifier") === metadata.APP_ID, "the app bundle id should match shared metadata");
assert(plistValue("CFBundleDisplayName") === metadata.APP_NAME, "the app display name should match shared metadata");
assert(plistValue("CFBundleExecutable") === metadata.APP_NAME, "the app executable name should match shared metadata");
assert(plistValue("CFBundleShortVersionString") === projectPackage.version, "the app version should match package.json");
assert(existsSync(join(appPath, `Contents/MacOS/${metadata.APP_NAME}`)), "the named Vibe Tree executable should exist");
assert(appPackage.productName === metadata.APP_NAME, "the packaged Electron product name should match shared metadata");
assert(buildMarker.appId === metadata.APP_ID && buildMarker.buildFingerprint, "the reusable build marker should be valid");
assert(packagedMetadata.includes(metadata.MAC_TRAY_GUID), "the packaged app should contain the stable tray GUID");
assert(existsSync(menuBarHelperPath), "the native macOS menu bar helper should be packaged");
const menuBarHelperCheck = execFileSync(
  menuBarHelperPath,
  ["--check", join(resourcesDir, "app/renderer/assets/menu-bar-sprout.png")],
  { encoding: "utf8" },
);
assert(menuBarHelperCheck.includes("helper check passed"), "the menu bar helper should load its packaged icon");
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "ignore" });

const expectedFingerprint = computeMacBuildFingerprint({
  root,
  userDataDir: buildMarker.userDataDir ?? undefined,
  paths: [
    join(root, "dist/electron"),
    join(root, "dist/renderer"),
    join(root, "dist/shared"),
    join(root, "package.json"),
    join(root, "public/assets/app-icon.png"),
    menuBarHelperSource,
    join(sourceApp, "Contents/Info.plist"),
    packageScriptPath,
  ],
});
assert(buildMarker.buildFingerprint === expectedFingerprint, "the packaged app should match the current build fingerprint");

const packageEnv = { ...process.env };
if (buildMarker.userDataDir) packageEnv.VIBE_TREE_PACKAGE_USER_DATA_DIR = buildMarker.userDataDir;
else delete packageEnv.VIBE_TREE_PACKAGE_USER_DATA_DIR;
const reuseOutput = execFileSync(process.execPath, [packageScriptPath], { encoding: "utf8", env: packageEnv });
assert(reuseOutput.includes(`Reusing ${appPath}`), "an unchanged app bundle should take the reuse path");

console.log("macOS app package tests passed");
