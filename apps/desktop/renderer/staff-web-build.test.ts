import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The portal build empties apps/portal/dist and the staff web builds into its staff folder,
// so every Hosting deploy must build the portal first and the staff web after it.
describe("Hosting deploy", () => {
  it("builds the portal before the staff web", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../../firebase.json", import.meta.url), "utf8"),
    ) as { hosting: { predeploy?: string | string[] } };
    const wanted = [
      "npm run build -w @sycamore/shared",
      "npm run build -w @sycamore/portal",
      "npm run build:web -w @sycamore/desktop",
    ];
    const steps = [config.hosting.predeploy ?? []].flat();
    expect(steps.filter((step) => wanted.includes(step))).toEqual(wanted);
  });
});
