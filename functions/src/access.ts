import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { hasRole, roleSchema, type Role } from "@sycamore/shared";
export function requireRoles(
  request: CallableRequest,
  allowed: readonly Role[],
) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const roles = z.array(roleSchema).catch([]).parse(request.auth.token.roles);
  if (!hasRole(roles, allowed))
    throw new HttpsError(
      "permission-denied",
      "Your role cannot make this change.",
    );
  return { uid: request.auth.uid, roles };
}
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const value = schema.safeParse(data);
  if (!value.success)
    throw new HttpsError("invalid-argument", "Check the fields and try again.");
  return value.data;
}
