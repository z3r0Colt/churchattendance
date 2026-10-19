import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "functions/**/*.test.ts",
      "apps/desktop/renderer/**/*.test.ts",
    ],
  },
});
