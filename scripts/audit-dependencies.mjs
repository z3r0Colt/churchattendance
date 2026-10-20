import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["audit", "--json"],
  { encoding: "utf8" },
);
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  throw new Error("Dependency audit could not complete.");
}
if (report.error || !report.vulnerabilities)
  throw new Error("Dependency audit could not complete.");
const exceptions = JSON.parse(
  readFileSync(
    new URL("../docs/dependency-exceptions.json", import.meta.url),
    "utf8",
  ),
);
const unreviewed = [];
for (const [name, dependency] of Object.entries(report.vulnerabilities)) {
  for (const advisory of dependency.via.filter(
    (entry) => typeof entry === "object",
  )) {
    if (!["high", "critical"].includes(advisory.severity)) continue;
    const exception = exceptions.find(
      (entry) =>
        entry.package === name &&
        entry.url === advisory.url &&
        Date.parse(entry.expires) > Date.now(),
    );
    if (!exception) unreviewed.push(`${name}: ${advisory.url}`);
  }
}
console.log("Dependency audit totals:", report.metadata.vulnerabilities);
if (unreviewed.length)
  throw new Error(
    `Unreviewed high/critical dependency findings:\n${unreviewed.join("\n")}`,
  );
console.log(
  "No unreviewed high/critical dependency findings. Time-limited exceptions remain in docs/dependency-exceptions.json.",
);
