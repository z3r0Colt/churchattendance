import type { DecodedIdToken } from "firebase-admin/auth";
export type AccessState = {
  enabled?: boolean;
  locked?: boolean;
  roles?: string[];
  validAfter?: number;
};
export type PasskeySession = {
  uid?: string;
  expiresAt?: number | { toMillis(): number };
  validAfter?: number;
};
export function hasAssurance(
  token: Pick<DecodedIdToken, "auth_time"> & Record<string, unknown>,
  uid: string,
  state: AccessState,
  session: PasskeySession | null,
  now = Date.now(),
) {
  const firebase = token.firebase as
    { sign_in_second_factor?: string } | undefined;
  const expiresAt =
    typeof session?.expiresAt === "number"
      ? session.expiresAt
      : session?.expiresAt?.toMillis() || 0;
  return (
    state.enabled === true &&
    state.locked !== true &&
    token.email_verified === true &&
    token.auth_time >= (state.validAfter || 0) &&
    (firebase?.sign_in_second_factor === "totp" ||
      firebase?.sign_in_second_factor === "phone" ||
      (!!token.passkeySession &&
        session?.uid === uid &&
        expiresAt > now &&
        session.validAfter === (state.validAfter || 0)))
  );
}
export function recentAuthentication(authTime: number, now = Date.now()) {
  return (
    authTime > 0 &&
    authTime * 1000 <= now + 30_000 &&
    now - authTime * 1000 < 5 * 60_000
  );
}
