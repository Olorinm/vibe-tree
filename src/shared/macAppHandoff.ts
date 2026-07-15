export interface MacAppHandoffContext {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
  isDev: boolean;
  isSmokeTest: boolean;
  terminalRoot?: string;
}

export function isMacAppBundleExecutable(execPath: string) {
  return /\/Vibe Tree\.app\/Contents\/MacOS\/[^/]+$/.test(execPath.replace(/\\/g, "/"));
}

export function shouldHandoffToMacApp(context: MacAppHandoffContext) {
  return (
    context.platform === "darwin" &&
    !context.isPackaged &&
    !isMacAppBundleExecutable(context.execPath) &&
    !context.isDev &&
    !context.isSmokeTest &&
    Boolean(context.terminalRoot)
  );
}
