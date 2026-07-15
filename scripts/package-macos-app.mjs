import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { computeMacBuildFingerprint } from "./macos-package-support.mjs";

if (process.platform !== "darwin") {
  throw new Error("The macOS app bundle can only be built on macOS.");
}

const root = process.cwd();
const projectPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = String(projectPackage.version);
const metadataPath = join(root, "dist/shared/appMetadata.js");
const sourceApp = join(root, "node_modules/electron/dist/Electron.app");
const outputApp = join(root, "dist/Vibe Tree.app");
const resourcesDir = join(outputApp, "Contents/Resources");
const packagedAppDir = join(resourcesDir, "app");
const plistPath = join(outputApp, "Contents/Info.plist");
const buildMarkerPath = join(resourcesDir, "vibe-tree-build.json");
const iconSource = join(root, "public/assets/app-icon.png");
const iconsetDir = join(root, "dist/.vibe-tree.iconset");
const iconPath = join(resourcesDir, "vibe-tree.icns");
const userDataDir = process.env.VIBE_TREE_PACKAGE_USER_DATA_DIR?.trim();
const plistBuddy = "/usr/libexec/PlistBuddy";

if (!existsSync(sourceApp)) throw new Error(`Electron.app not found: ${sourceApp}`);
if (!existsSync(join(root, "dist/electron/main.js"))) throw new Error("Run npm run build before packaging.");
if (!existsSync(metadataPath)) throw new Error("Compiled app metadata is missing. Run npm run build before packaging.");
if (!existsSync(iconSource)) throw new Error(`App icon not found: ${iconSource}`);

const { APP_ID, APP_NAME } = await import(pathToFileURL(metadataPath).href);
const legacyExecutablePath = join(outputApp, "Contents/MacOS/Electron");
const executablePath = join(outputApp, `Contents/MacOS/${APP_NAME}`);

function appIsRunning() {
  if (!existsSync(outputApp)) return false;
  const processList = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" });
  const executablePaths = new Set([executablePath, legacyExecutablePath]);
  return processList.split("\n").some((line) => executablePaths.has(line.trim()));
}

const fingerprintPaths = [
  join(root, "dist/electron"),
  join(root, "dist/renderer"),
  join(root, "dist/shared"),
  join(root, "package.json"),
  iconSource,
  join(sourceApp, "Contents/Info.plist"),
  fileURLToPath(import.meta.url),
];
const buildFingerprint = computeMacBuildFingerprint({ root, paths: fingerprintPaths, userDataDir });

if (existsSync(buildMarkerPath)) {
  try {
    const marker = JSON.parse(readFileSync(buildMarkerPath, "utf8"));
    const bundleId = execFileSync(plistBuddy, ["-c", "Print :CFBundleIdentifier", plistPath], { encoding: "utf8" }).trim();
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", outputApp], { stdio: "ignore" });
    if (marker.buildFingerprint === buildFingerprint && bundleId === APP_ID) {
      console.log(`Reusing ${outputApp}`);
      process.exit(0);
    }
  } catch {
    // Rebuild incomplete or invalid bundles.
  }
}

if (appIsRunning()) throw new Error("Vibe Tree.app is running. Quit it before rebuilding the app bundle.");

rmSync(outputApp, { force: true, recursive: true });
execFileSync("/usr/bin/ditto", [sourceApp, outputApp]);
renameSync(legacyExecutablePath, executablePath);

rmSync(packagedAppDir, { force: true, recursive: true });
mkdirSync(packagedAppDir, { recursive: true });
for (const directory of ["electron", "renderer", "shared"]) {
  cpSync(join(root, "dist", directory), join(packagedAppDir, directory), { recursive: true });
}
writeFileSync(
  join(packagedAppDir, "package.json"),
  `${JSON.stringify(
    {
      name: "vibe-tree",
      productName: APP_NAME,
      version,
      main: "electron/main.js",
    },
    null,
    2,
  )}\n`,
);

const setPlist = (key, value) => execFileSync(plistBuddy, ["-c", `Set :${key} ${value}`, plistPath]);
setPlist("CFBundleDisplayName", APP_NAME);
setPlist("CFBundleName", APP_NAME);
setPlist("CFBundleExecutable", APP_NAME);
setPlist("CFBundleIdentifier", APP_ID);
setPlist("CFBundleShortVersionString", version);
setPlist("CFBundleVersion", version);
setPlist("CFBundleIconFile", "vibe-tree.icns");
setPlist("LSApplicationCategoryType", "public.app-category.utilities");

if (userDataDir) {
  try {
    execFileSync(plistBuddy, ["-c", "Add :LSEnvironment dict", plistPath], { stdio: "ignore" });
  } catch {
    // Electron already defines LSEnvironment in current releases.
  }
  try {
    execFileSync(plistBuddy, ["-c", `Set :LSEnvironment:VIBE_TREE_USER_DATA_DIR ${userDataDir}`, plistPath], {
      stdio: "ignore",
    });
  } catch {
    execFileSync(plistBuddy, ["-c", `Add :LSEnvironment:VIBE_TREE_USER_DATA_DIR string ${userDataDir}`, plistPath]);
  }
}

rmSync(iconsetDir, { force: true, recursive: true });
mkdirSync(iconsetDir, { recursive: true });
const iconSizes = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];
for (const [size, name] of iconSizes) {
  execFileSync("/usr/bin/sips", ["-z", String(size), String(size), iconSource, "--out", join(iconsetDir, name)], {
    stdio: "ignore",
  });
}
execFileSync("/usr/bin/iconutil", ["-c", "icns", iconsetDir, "-o", iconPath]);
rmSync(iconsetDir, { force: true, recursive: true });

writeFileSync(
  buildMarkerPath,
  `${JSON.stringify({ appId: APP_ID, buildFingerprint, userDataDir: userDataDir ?? null, version }, null, 2)}\n`,
);
execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", outputApp]);
console.log(outputApp);
