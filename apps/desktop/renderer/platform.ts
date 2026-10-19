// Set at build time: false for the Electron renderer, true for the staff web build served at /staff/.
export const staffWeb = __STAFF_WEB__;
// The named preload functions. The staff web build never has them, so its bundle carries no native calls.
export const native = staffWeb ? undefined : window.desktop;
// The device word used in sync messages and settings.
export const deviceName = staffWeb ? "this tab" : "this PC";
// Passkeys and authenticators are managed on the church security page, on the same origin as the staff web.
export function staffSecurityUrl() {
  const configured =
    import.meta.env.VITE_STAFF_AUTH_ORIGIN ||
    (import.meta.env.VITE_USE_EMULATORS === "true" || import.meta.env.DEV
      ? "http://localhost:5174"
      : location.origin);
  return new URL("/staff-security", configured).href;
}
