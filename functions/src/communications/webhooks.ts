import { timingSafeEqual, createHmac } from "node:crypto";
import twilio from "twilio";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import {
  inboundSmsSchema,
  normalizeEmail,
  normalizePhone,
  smsConsentKeyword,
  type Channel,
} from "@sycamore/shared";
import { db } from "../admin.js";
import {
  communicationSecret,
  emulatorMode,
  providerConfig,
} from "./environment.js";
import {
  deliveryAllowed,
  getSettings,
  identityHash,
  recount,
} from "./queue.js";
export const secretOptions = {
  secrets: emulatorMode() ? [] : [communicationSecret],
};

function signedTwilio(
  request: Request,
  handler: "twilioInbound" | "twilioStatus",
) {
  const config = providerConfig();
  if (
    !config.twilio ||
    request.method !== "POST" ||
    !request.is("application/x-www-form-urlencoded")
  )
    return false;
  const values = z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .safeParse(request.body);
  if (!values.success) return false;
  const query = request.originalUrl.includes("?")
    ? `?${request.originalUrl.split("?").slice(1).join("?")}`
    : "";
  const url = `${config.publicFunctionsUrl}/${handler}${query}`;
  return (
    twilio.validateRequest(
      config.twilio.authToken,
      request.header("X-Twilio-Signature") || "",
      url,
      values.data,
    ) && values.data.AccountSid === config.twilio.accountSid
  );
}
export async function changeConsent(
  channel: Channel,
  address: string,
  blocked: boolean,
  source: string,
  actor = "system",
  messageSid?: string,
) {
  const all = await db.collection("people").get();
  const matches = all.docs.filter((person) => {
    try {
      return (
        (channel === "email"
          ? normalizeEmail(person.get("email") || "")
          : normalizePhone(person.get("mobilePhone") || "")) === address
      );
    } catch {
      return false;
    }
  });
  await db.runTransaction(async (transaction) => {
    const inbox = messageSid ? db.doc(`smsInbox/${messageSid}`) : null;
    if (inbox && (await transaction.get(inbox)).exists) return;
    const current = await Promise.all(
      matches.map((person) => transaction.get(person.ref)),
    );
    transaction.set(
      db.doc(`communicationSuppressions/${identityHash(channel, address)}`),
      { blocked, channel, updatedAt: FieldValue.serverTimestamp(), source },
    );
    // A contact may have changed after the initial lookup. Never grant consent to its new address.
    const matchingCurrent = current.filter((person) => {
      if (!person.exists) return false;
      try {
        return (
          (channel === "email"
            ? normalizeEmail(person.get("email") || "")
            : normalizePhone(person.get("mobilePhone") || "")) === address
        );
      } catch {
        return false;
      }
    });
    for (const person of matchingCurrent) {
      transaction.update(person.ref, {
        [channel === "email" ? "emailOptIn" : "smsOptIn"]: !blocked,
        updatedBy: actor,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(db.collection("consentEvents").doc(), {
        personId: person.id,
        channel,
        optedIn: !blocked,
        source,
        actor,
        at: FieldValue.serverTimestamp(),
      });
    }
    if (inbox)
      transaction.create(inbox, {
        fromNumber: address,
        personIds: matchingCurrent.map((person) => person.id),
        body: source,
        read: false,
        receivedAt: FieldValue.serverTimestamp(),
        consentCommand: true,
      });
  });
  return matches.map((person) => person.id);
}
export const twilioInbound = onRequest(
  secretOptions,
  async (request, response) => {
    if (!signedTwilio(request, "twilioInbound")) {
      response.status(403).send("Invalid signature");
      return;
    }
    const parsed = inboundSmsSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).send("Invalid message");
      return;
    }
    const input = parsed.data;
    const config = providerConfig();
    if (input.To !== config.twilio?.from) {
      response.status(400).send("Wrong recipient");
      return;
    }
    let phone: string;
    try {
      phone = normalizePhone(input.From);
    } catch {
      response.status(400).send("Invalid sender");
      return;
    }
    const keyword = smsConsentKeyword(input.Body, input.OptOutType);
    if (keyword === "stop" || keyword === "start") {
      await changeConsent(
        "sms",
        phone,
        keyword === "stop",
        input.Body,
        "sms-webhook",
        input.MessageSid,
      );
    } else {
      const people = await db.collection("people").get();
      const matches = people.docs.filter((row) => {
        try {
          return normalizePhone(row.get("mobilePhone") || "") === phone;
        } catch {
          return false;
        }
      });
      await db.runTransaction(async (transaction) => {
        const ref = db.doc(`smsInbox/${input.MessageSid}`);
        if (!(await transaction.get(ref)).exists)
          transaction.create(ref, {
            fromNumber: phone,
            personIds: matches.map((row) => row.id),
            body: input.Body,
            receivedAt: FieldValue.serverTimestamp(),
            read: false,
            consentCommand: false,
          });
      });
      const consent = (
        await Promise.all(
          matches.map((row) => deliveryAllowed(row.id, "sms", phone)),
        )
      ).some(Boolean);
      if (keyword === "help" && consent && !input.OptOutType) {
        response
          .type("text/xml")
          .send(
            "<Response><Message>Contact the church office for help. Reply STOP to opt out.</Message></Response>",
          );
        return;
      }
    }
    response.type("text/xml").send("<Response/>");
  },
);
const smsStates: Record<string, number> = {
  accepted: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  failed: 4,
  undelivered: 4,
};
export const twilioStatus = onRequest(
  secretOptions,
  async (request, response) => {
    if (!signedTwilio(request, "twilioStatus")) {
      response.status(403).send("Invalid signature");
      return;
    }
    const input = z
      .object({
        MessageSid: z.string().regex(/^SM[a-fA-F0-9]{32}$/),
        MessageStatus: z.enum([
          "accepted",
          "queued",
          "sending",
          "sent",
          "delivered",
          "read",
          "failed",
          "undelivered",
        ]),
        ErrorCode: z.string().optional(),
      })
      .safeParse(request.body);
    const params = z
      .object({
        messageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        recipientId: z.string().regex(/^[A-Za-z0-9_-]{1,180}$/),
        attempt: z.string().max(400),
      })
      .safeParse(request.query);
    if (!input.success || !params.success) {
      response.status(400).send("Invalid status");
      return;
    }
    const parent = db.doc(`messages/${params.data.messageId}`);
    const ref = parent.collection("recipients").doc(params.data.recipientId);
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (
        !current.exists ||
        current.get("channel") !== "sms" ||
        current.get("attemptKey") !== params.data.attempt ||
        (current.get("providerId") &&
          current.get("providerId") !== input.data.MessageSid)
      )
        return;
      const old = current.get("status") as string;
      if (
        ["delivered", "read", "failed", "undelivered", "skipped"].includes(
          old,
        ) &&
        (smsStates[input.data.MessageStatus] ?? 0) <= (smsStates[old] ?? 10)
      )
        return;
      if ((smsStates[input.data.MessageStatus] ?? 0) < (smsStates[old] ?? 0))
        return;
      transaction.update(ref, {
        status: input.data.MessageStatus,
        providerId: input.data.MessageSid,
        error: input.data.ErrorCode
          ? `Twilio error ${input.data.ErrorCode}`
          : "",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await recount(parent);
    response.sendStatus(204);
  },
);
function unsubscribePayload(token: string) {
  if (token.length > 2000) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", providerConfig().unsubscribeSecret)
    .update(payload)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
    return null;
  try {
    return z
      .object({
        personId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        address: z.email(),
      })
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  } catch {
    return null;
  }
}
export const emailUnsubscribe = onRequest(
  secretOptions,
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    response.set(
      "Content-Security-Policy",
      "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'",
    );
    const token =
      typeof request.query.token === "string" ? request.query.token : "";
    const payload = unsubscribePayload(token);
    if (!payload || !["GET", "POST"].includes(request.method)) {
      response.status(400).send("This unsubscribe link is not valid.");
      return;
    }
    if (request.method === "GET") {
      response
        .type("html")
        .send(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Church email preferences</title><body><h1>Church email preferences</h1><form method="post"><p>Stop church emails to this address?</p><button type="submit">Stop church emails</button></form></body></html>',
        );
      return;
    }
    await changeConsent(
      "email",
      normalizeEmail(payload.address),
      true,
      "Email unsubscribe",
      "email-unsubscribe",
    );
    response.send("You have been unsubscribed from church email.");
  },
);
export const bulletinDownload = onRequest(async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (
    request.method !== "GET" ||
    typeof request.query.token !== "string" ||
    !/^[a-f0-9]{48}$/.test(request.query.token)
  ) {
    response.sendStatus(404);
    return;
  }
  try {
    const link = await db.doc(`bulletinLinks/${request.query.token}`).get();
    if (!link.exists || !(await getSettings()).shareBulletinLink) {
      response.sendStatus(404);
      return;
    }
    const [bytes] = await getStorage()
      .bucket()
      .file(link.get("path"), { generation: link.get("generation") })
      .download();
    response
      .set("X-Content-Type-Options", "nosniff")
      .type("application/pdf")
      .send(bytes);
  } catch {
    response.sendStatus(404);
  }
});
