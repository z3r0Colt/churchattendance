import { z } from "zod";

// Presets keep both themes readable; arbitrary CSS, SVG and remote logos are not accepted.
export const brandPalettes = {
  forest: { light: "#2F6B4F", dark: "#9BD0B4" },
  navy: { light: "#234E70", dark: "#A8CAE5" },
  plum: { light: "#70405E", dark: "#DCB3CD" },
} as const;
export const BRAND_LOGO_BYTES = 65536;
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const publicText = (max: number) => z.string().trim().max(max)
  .refine((value) => ![...value].some((char) => char.charCodeAt(0) < 32) && !/[<>]/.test(value), "Use plain text");
const httpsUrl = z.union([z.literal(""), z.url().max(500).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use an HTTPS website address")]);
export const brandingFieldsSchema = z.object({
  churchName: publicText(150).min(1),
  appName: publicText(80).min(1),
  subtitle: publicText(150).default(""),
  palette: z.enum(["forest", "navy", "plum"]).default("forest"),
  website: httpsUrl.default(""),
  contactEmail: z.union([z.literal(""), z.email().max(254)]).default(""),
  contactPhone: publicText(40).default(""),
  // PNG only, re-encoded by the editor. No URLs, SVG, HTML or active content.
  logo: z.string().max(Math.ceil(BRAND_LOGO_BYTES / 3) * 4 + 22)
    .regex(/^(?:|data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2})$/).default(""),
}).strict();
export const publicBrandingSchema = brandingFieldsSchema.extend({
  churchId: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/),
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/),
}).strict();
export type PublicBranding = z.infer<typeof publicBrandingSchema>;
export const saveBrandingSchema = brandingFieldsSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
}).strict();
// Never spread a stored settings document into a public response. Unknown fields are discarded here.
export function publicBrandingPayload(value: Record<string, unknown>) {
  return publicBrandingSchema.parse(Object.fromEntries(
    Object.keys(publicBrandingSchema.shape).map((key) => [key, value[key]]),
  ));
}
export const brandingFilename = (name: string) =>
  name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "church";

// Build/environment values only. Never consume query parameters or editable church settings here.
export function firebaseDeployment(env: Record<string, string | boolean | undefined>, local: boolean, origin?: string) {
  if (local) return {
    apiKey: String(env.VITE_FIREBASE_API_KEY || "demo-key"),
    authDomain: String(env.VITE_FIREBASE_AUTH_DOMAIN || "demo-sycamore.firebaseapp.com"),
    projectId: String(env.VITE_FIREBASE_PROJECT_ID || "demo-sycamore"),
    storageBucket: String(env.VITE_FIREBASE_STORAGE_BUCKET || "demo-sycamore.appspot.com"),
    appId: String(env.VITE_FIREBASE_APP_ID || "demo-app"),
  };
  const required = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_APP_ID", "VITE_DEPLOYMENT_PROJECT_ID", "VITE_CHURCH_ID", "VITE_CHURCH_ORIGIN"];
  if (required.some((key) => typeof env[key] !== "string" || !env[key]))
    throw new Error("Church deployment configuration is incomplete. Contact the service operator.");
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID);
  const expectedOrigin = new URL(String(env.VITE_CHURCH_ORIGIN));
  if (projectId.startsWith("demo-") || projectId !== env.VITE_DEPLOYMENT_PROJECT_ID ||
      !/^[a-z][a-z0-9-]{4,29}$/.test(projectId) ||
      !/^[a-z][a-z0-9-]{2,62}$/.test(String(env.VITE_CHURCH_ID)) ||
      expectedOrigin.protocol !== "https:" || expectedOrigin.origin !== env.VITE_CHURCH_ORIGIN ||
      (origin !== undefined && origin !== expectedOrigin.origin))
    throw new Error("This app does not match its approved church deployment. Contact the service operator.");
  return {
    apiKey: String(env.VITE_FIREBASE_API_KEY), authDomain: String(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId, storageBucket: String(env.VITE_FIREBASE_STORAGE_BUCKET), appId: String(env.VITE_FIREBASE_APP_ID),
  };
}
