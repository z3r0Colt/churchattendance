import { describe, expect, it } from "vitest";
import { brandPalettes, brandingFieldsSchema, contrastRatio, firebaseDeployment, publicBrandingPayload, saveBrandingSchema } from "./branding.js";
const cedar = { projectId: "cedar-example", churchId: "cedar-church", churchName: "Cedar Reformed Church", appName: "Cedar", palette: "forest" };
const harbor = { projectId: "harbor-example", churchId: "harbor-church", churchName: "Harbor Presbyterian Church", appName: "Harbor", palette: "navy" };
describe("public church identity", () => {
  it("projects only reviewed fields, including for two independent church configurations", () => {
    for (const config of [cedar, harbor]) {
      const payload = publicBrandingPayload({ ...config, administratorEmail: "private@example.test", providerStatus: "private", revision: 7, updatedBy: "private-uid" });
      expect(payload.churchName).toBe(config.churchName);
      expect(payload.projectId).toBe(config.projectId);
      expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(["administratorEmail", "providerStatus", "revision", "updatedBy"]));
      expect(JSON.stringify(payload)).not.toContain("private");
    }
  });
  it("rejects active content, remote logos, overlarge logos and unknown write fields", () => {
    for (const patch of [
      { logo: "https://tracker.example.test/logo.png" }, { logo: "data:image/svg+xml;base64,PHN2Zz4=" },
      { logo: "data:image/png;base64,iVBORw0KGgo" + "A".repeat(90000) },
      { website: "javascript:alert(1)" }, { website: "https://user:password@example.test" },
      { churchName: "<script>" }, { appName: "" }, { palette: "#ffff00" }, { administratorEmail: "private@example.test" },
    ]) expect(brandingFieldsSchema.safeParse({ churchName: cedar.churchName, appName: cedar.appName, ...patch }).success).toBe(false);
    expect(saveBrandingSchema.safeParse({ churchName: cedar.churchName, appName: cedar.appName, expectedRevision: 0, projectId: harbor.projectId }).success).toBe(false);
  });
  it("requires a complete identity instead of falling back to a different church", () => {
    expect(() => publicBrandingPayload({})).toThrow();
    expect(() => publicBrandingPayload({ ...cedar, projectId: undefined })).toThrow();
  });
  it("keeps text readable on approved backgrounds in both themes", () => {
    for (const palette of Object.values(brandPalettes)) {
      expect(contrastRatio(palette.light, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.light, "#F6F4EE")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.dark, "#222624")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.dark, "#181B1A")).toBeGreaterThanOrEqual(4.5);
    }
  });
});
const production = {
  VITE_FIREBASE_PROJECT_ID: "cedar-example", VITE_DEPLOYMENT_PROJECT_ID: "cedar-example",
  VITE_CHURCH_ID: "cedar-church", VITE_CHURCH_ORIGIN: "https://cedar.example.test",
  VITE_FIREBASE_API_KEY: "public-key", VITE_FIREBASE_AUTH_DOMAIN: "cedar-example.firebaseapp.com",
  VITE_FIREBASE_STORAGE_BUCKET: "cedar-example.firebasestorage.app", VITE_FIREBASE_APP_ID: "public-app-id",
};
describe("trusted Firebase selection", () => {
  it("requires explicit production identity and pins the expected origin/project", () => {
    expect(firebaseDeployment(production, false, "https://cedar.example.test").projectId).toBe("cedar-example");
    expect(() => firebaseDeployment({}, false)).toThrow();
    expect(() => firebaseDeployment({ ...production, VITE_FIREBASE_PROJECT_ID: "harbor-example" }, false)).toThrow();
    expect(() => firebaseDeployment(production, false, "https://harbor.example.test")).toThrow();
    expect(() => firebaseDeployment({ ...production, VITE_FIREBASE_PROJECT_ID: "demo-cedar", VITE_DEPLOYMENT_PROJECT_ID: "demo-cedar" }, false)).toThrow();
    expect(() => firebaseDeployment({ ...production, VITE_CHURCH_ORIGIN: "https://cedar.example.test/other" }, false)).toThrow();
  });
  it("uses demo defaults only when an emulator/development build was explicitly selected", () => {
    expect(firebaseDeployment({}, true).projectId).toBe("demo-sycamore");
  });
});
