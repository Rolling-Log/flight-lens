import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const referencedFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...manifest.content_scripts.flatMap((entry) => entry.js),
].filter(Boolean);

for (const file of referencedFiles) await access(new URL(file, root));
for (const file of referencedFiles.filter((file) => file.endsWith(".js"))) {
  const checked = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(file, root))], {
    encoding: "utf8",
  });
  if (checked.status !== 0) throw new Error(checked.stderr || `Invalid JavaScript: ${file}`);
}

for (const domain of ["ctrip.com", "qunar.com", "ly.com", "fliggy.com"]) {
  if (!manifest.host_permissions.some((permission) => permission.includes(domain))) {
    throw new Error(`Missing host permission for ${domain}`);
  }
}

console.log(`Validated Edge Companion ${manifest.version}: ${referencedFiles.length} files.`);
