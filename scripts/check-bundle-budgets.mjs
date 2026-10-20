import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
const budgets = [
  ["Desktop", "apps/desktop/dist/renderer", 510_000],
  ["Staff web", "apps/portal/dist/staff", 480_000],
  ["Member portal", "apps/portal/dist", 260_000],
];
for (const [name, directory, maximum] of budgets) {
  const html = readFileSync(join(directory, "index.html"), "utf8");
  const entry = html.match(/<script[^>]+src="([^"]+\.js)"/)[1];
  const bytes = gzipSync(
    readFileSync(join(directory, "assets", basename(entry))),
  ).length;
  console.log(`${name}: ${bytes} gzip bytes, budget ${maximum}`);
  if (bytes > maximum)
    throw new Error(`${name} exceeds its initial JavaScript budget.`);
}
