import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

function addPathToHash(hash, root, path) {
  const stats = statSync(path);
  hash.update(relative(root, path));
  if (stats.isDirectory()) {
    for (const name of readdirSync(path).sort()) addPathToHash(hash, root, join(path, name));
    return;
  }
  hash.update(readFileSync(path));
}

export function computeMacBuildFingerprint({ root, paths, userDataDir }) {
  const hash = createHash("sha256");
  for (const path of [...paths, fileURLToPath(import.meta.url)]) addPathToHash(hash, root, path);
  hash.update(userDataDir ?? "");
  return hash.digest("hex");
}
