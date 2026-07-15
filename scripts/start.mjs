import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveMacUserDataOverride } from "./macos-user-data.mjs";

const root = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function macUserDataOverride() {
  const appSupport = join(homedir(), "Library/Application Support");
  return resolveMacUserDataOverride(appSupport, process.env.VIBE_TREE_USER_DATA_DIR);
}

function runningMacAppPids(executablePath) {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter((match) => match?.[2] === executablePath)
    .map((match) => Number(match[1]));
}

async function stopRunningMacApp(executablePath) {
  const pids = runningMacAppPids(executablePath);
  for (const pid of pids) process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && runningMacAppPids(executablePath).length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const remainingPids = runningMacAppPids(executablePath);
  if (remainingPids.length > 0) {
    throw new Error(`Vibe Tree is still running (${remainingPids.join(", ")}). Quit it and run npm start again.`);
  }
}

async function startMacApp() {
  const appPath = join(root, "dist/Vibe Tree.app");
  const executablePath = join(appPath, "Contents/MacOS/Vibe Tree");
  const legacyExecutablePath = join(appPath, "Contents/MacOS/Electron");
  await stopRunningMacApp(executablePath);
  await stopRunningMacApp(legacyExecutablePath);

  const packageEnv = { ...process.env };
  const userDataDir = macUserDataOverride();
  if (userDataDir) packageEnv.VIBE_TREE_PACKAGE_USER_DATA_DIR = userDataDir;
  else delete packageEnv.VIBE_TREE_PACKAGE_USER_DATA_DIR;
  run(process.execPath, [join(root, "scripts/package-macos-app.mjs")], { env: packageEnv });

  const appEnv = { ...process.env };
  if (userDataDir) appEnv.VIBE_TREE_USER_DATA_DIR = userDataDir;
  const appProcess = spawn(executablePath, [], { env: appEnv, stdio: "inherit" });
  let stopping = false;
  const stopAndExit = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    try {
      await stopRunningMacApp(executablePath);
    } catch (error) {
      console.error(error);
      code = 1;
    } finally {
      if (!appProcess.killed) appProcess.kill();
      process.exit(code);
    }
  };
  process.once("SIGINT", () => void stopAndExit());
  process.once("SIGTERM", () => void stopAndExit());
  appProcess.once("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  appProcess.once("exit", (code) => {
    if (stopping) return;
    process.exit(code ?? 0);
  });
}

run(npmCommand, ["run", "build"]);
if (process.platform === "darwin") {
  await startMacApp();
} else {
  const electronCommand = join(
    root,
    "node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );
  const electron = spawn(electronCommand, ["dist/electron/main.js"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  electron.once("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  electron.once("exit", (code) => process.exit(code ?? 0));
}
