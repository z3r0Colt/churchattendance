import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    // Unit tests use the shared source, not its gitignored build in lib/,
    // so they run on a fresh checkout and never test stale schemas.
    alias: [
      {
        find: /^@sycamore\/shared$/,
        replacement: fileURLToPath(
          new URL("./packages/shared/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "functions/**/*.test.ts",
      "apps/desktop/renderer/**/*.test.ts",
    ],
  },
});
