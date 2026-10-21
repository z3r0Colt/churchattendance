import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
const budgets = [
  ["Staff web", "apps/portal/dist/staff", 480_000],
  ["Member portal", "apps/portal/dist", 260_000],
];
for (const [name, directory, maximum] of budgets) {
  const manifest = JSON.parse(readFileSync(join(directory, ".vite/manifest.json"), "utf8"));
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entry) throw new Error(`${name} has no application entry.`);
  const seen = new Set();
  const visit = (chunk) => {
    if (seen.has(chunk.file)) return;
    seen.add(chunk.file);
    for (const dependency of chunk.imports || []) visit(manifest[dependency]);
  };
  visit(entry);
  // Bootstraps use dynamic imports to catch configuration failures before mounting.
  // Count those required first-hop chunks and their static graph, while feature screens remain lazy.
  for (const dependency of entry.dynamicImports || []) visit(manifest[dependency]);
  const bytes = [...seen].filter((file) => file.endsWith(".js")).reduce(
    (sum, file) => sum + gzipSync(readFileSync(join(directory, file))).length, 0,
  );
  console.log(`${name}: ${bytes} startup JavaScript gzip bytes, budget ${maximum}`);
  if (bytes > maximum)
    throw new Error(`${name} exceeds its initial JavaScript budget.`);
}
