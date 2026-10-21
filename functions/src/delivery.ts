import { defineString } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";
const delivery = defineString("SERVICE_DELIVERY", { default: "pwa" });
export function requireLegacyDelivery() {
  if (delivery.value() !== "legacy")
    throw new HttpsError("failed-precondition", "This capability is retired for the church web service.");
}
