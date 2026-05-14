import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const from = join(process.cwd(), "src/electron/preload.cjs");
const to = join(process.cwd(), "dist/electron/preload.cjs");
const rootPkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);

writeCommonJsPackage("dist/electron", { main: "main.js" });
writeCommonJsPackage("dist/shared");

function writeCommonJsPackage(directory, extra = {}) {
  const target = join(process.cwd(), directory);
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify(
      {
        name: rootPkg.name,
        productName: rootPkg.productName,
        version: rootPkg.version,
        type: "commonjs",
        ...extra,
      },
      null,
      2,
    ),
    "utf8",
  );
}
