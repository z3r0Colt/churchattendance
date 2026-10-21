import { spawnSync } from "node:child_process";
const failed = [];
for (const script of ["audit:dependencies", "lint", "typecheck", "test", "test:operations", "test:rules"]) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], { stdio: "inherit", shell: false });
  if (result.status !== 0) failed.push(script);
}
if (failed.length) { console.error(`Failed checks: ${failed.join(", ")}`); process.exitCode = 1; }
