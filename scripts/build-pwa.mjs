import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const directory = "apps/portal/dist";
const assets = [];
for (const prefix of ["", "staff/"]) {
  const manifest = JSON.parse(readFileSync(`${directory}/${prefix}.vite/manifest.json`, "utf8"));
  for (const chunk of Object.values(manifest)) for (const file of [chunk.file, ...(chunk.css || []), ...(chunk.assets || [])]) {
    if (/^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|svg)$/.test(file)) assets.push(`/${prefix}${file}`);
  }
}
const unique = [...new Set(assets)].sort();
if (!unique.length) throw new Error("No hashed PWA assets found");
const hash = createHash("sha256");
for (const file of unique) hash.update(file).update(readFileSync(`${directory}${file}`));
const version = hash.digest("hex").slice(0, 20);
const worker = readFileSync("apps/pwa/service-worker.js", "utf8").replace('"__PWA_VERSION__"', JSON.stringify(version)).replace("__PWA_ASSETS__", JSON.stringify(unique));
writeFileSync(`${directory}/service-worker.js`, worker);
console.log(`PWA ${version}: ${unique.length} immutable public application files`);
if (process.env.CHURCH_RELEASE) {
  if (!/^[a-f0-9]{40}$/.test(process.env.CHURCH_RELEASE)) throw new Error("Invalid release commit");
  writeFileSync(`${directory}/release.json`, JSON.stringify({ release: process.env.CHURCH_RELEASE, projectId: process.env.VITE_DEPLOYMENT_PROJECT_ID, churchId: process.env.VITE_CHURCH_ID, origin: process.env.VITE_CHURCH_ORIGIN }));
}
