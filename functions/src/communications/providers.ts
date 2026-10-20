import twilio from "twilio";
import { randomUUID } from "node:crypto";
import { db } from "../admin.js";
import { getStorage } from "firebase-admin/storage";
import {
  emulatorMode,
  providerConfig,
  type ProviderConfig,
} from "./environment.js";

export type Attachment = { name: string; bytes: Buffer };
export type DeliveryResult = { id: string; status: "accepted" | "simulated" };
export type EmailDelivery = {
  key: string;
  to: string;
  subject: string;
  body: string;
  attachments: Attachment[];
  authorize?: () => Promise<boolean>;
};
export type SmsDelivery = {
  key: string;
  to: string;
  body: string;
  statusCallback: string;
  authorize?: () => Promise<boolean>;
};
export interface EmailProvider {
  send(input: EmailDelivery): Promise<DeliveryResult>;
  latestPdf(
    drive: string,
    folder: string,
    after: number,
  ): Promise<{
    id: string;
    name: string;
    bytes: Buffer;
    modified: string;
  } | null>;
}
export interface SmsProvider {
  send(input: SmsDelivery): Promise<DeliveryResult>;
}
export class DeliveryError extends Error {
  constructor(
    public readonly outcome: "failed" | "unknown" | "skipped" | "expired",
    message: string,
  ) {
    super(message);
  }
}
type Fetch = typeof fetch;
async function limitedBytes(response: Response, limit = 20 * 1024 * 1024) {
  if (!response.body)
    throw new DeliveryError("failed", "The attachment could not be read");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) {
      await response.body.cancel().catch(() => {});
      throw new DeliveryError("failed", "The attachment is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export class GraphEmailProvider implements EmailProvider {
  private token = "";
  private expires = 0;
  constructor(
    private config: NonNullable<ProviderConfig["graph"]>,
    private http: Fetch = fetch,
  ) {}
  private async accessToken() {
    if (this.token && Date.now() < this.expires) return this.token;
    const response = await this.http(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok)
      throw new DeliveryError(
        "failed",
        "Microsoft sign-in failed. Check the app permissions and credentials.",
      );
    const json = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    if (!json.access_token)
      throw new DeliveryError(
        "failed",
        "Microsoft did not return an access token",
      );
    this.token = json.access_token;
    this.expires = Date.now() + Math.max(0, json.expires_in - 120) * 1000;
    return this.token;
  }
  private async graph(
    path: string,
    options: RequestInit = {},
    sending = false,
    authorize?: () => Promise<boolean>,
  ) {
    const token = await this.accessToken();
    if (sending && authorize && !(await authorize()))
      throw new DeliveryError("skipped", "Consent or contact details changed");
    let result: Response;
    try {
      result = await this.http(`https://graph.microsoft.com/v1.0${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: AbortSignal.timeout(30000),
        redirect: "manual",
      });
    } catch {
      throw new DeliveryError(
        sending ? "unknown" : "failed",
        "Microsoft did not confirm the request. Check the delivery log before retrying.",
      );
    }
    if (!result.ok && result.status !== 302)
      throw new DeliveryError(
        sending && result.status >= 500 ? "unknown" : "failed",
        result.status === 429
          ? "Microsoft rate limit reached. Retry later."
          : "Microsoft rejected the request. Check mailbox and attachment permissions.",
      );
    return result;
  }
  async send(input: EmailDelivery): Promise<DeliveryResult> {
    const mailbox = `/users/${encodeURIComponent(this.config.mailbox)}`;
    const small = input.attachments.filter(
      (file) => file.bytes.length < 3_000_000,
    );
    const message = {
      subject: input.subject,
      body: { contentType: "Text", content: input.body },
      toRecipients: [{ emailAddress: { address: input.to } }],
      internetMessageHeaders: [
        { name: "X-Church-Delivery", value: input.key },
      ],
      attachments: small.map((file) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: file.name,
        contentType: "application/pdf",
        contentBytes: file.bytes.toString("base64"),
      })),
    };
    const directBody = JSON.stringify({ message, saveToSentItems: true });
    if (
      small.length === input.attachments.length &&
      Buffer.byteLength(directBody) < 4_000_000
    ) {
      const response = await this.graph(
        `${mailbox}/sendMail`,
        { method: "POST", body: directBody },
        true,
        input.authorize,
      );
      return {
        id: response.headers.get("request-id") || input.key,
        status: "accepted",
      };
    }
    // Separate attachment requests keep the combined base64 payload below Graph's request limit.
    const draft = (await (
      await this.graph(`${mailbox}/messages`, {
        method: "POST",
        body: JSON.stringify({ ...message, attachments: [] }),
      })
    ).json()) as { id: string };
    if (!draft.id)
      throw new DeliveryError(
        "failed",
        "Microsoft did not create an attachment draft",
      );
    for (const attachment of message.attachments)
      await this.graph(
        `${mailbox}/messages/${encodeURIComponent(draft.id)}/attachments`,
        { method: "POST", body: JSON.stringify(attachment) },
      );
    for (const file of input.attachments.filter(
      (item) => !small.includes(item),
    )) {
      const session = (await (
        await this.graph(
          `${mailbox}/messages/${encodeURIComponent(draft.id)}/attachments/createUploadSession`,
          {
            method: "POST",
            body: JSON.stringify({
              AttachmentItem: {
                attachmentType: "file",
                name: file.name,
                size: file.bytes.length,
                contentType: "application/pdf",
              },
            }),
          },
        )
      ).json()) as { uploadUrl: string };
      if (
        !session.uploadUrl ||
        new URL(session.uploadUrl).protocol !== "https:"
      )
        throw new DeliveryError(
          "failed",
          "Microsoft did not create an upload session",
        );
      const chunkSize = 320 * 1024 * 10;
      for (let start = 0; start < file.bytes.length; start += chunkSize) {
        const end = Math.min(file.bytes.length, start + chunkSize);
        const uploaded = await this.http(session.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(end - start),
            "Content-Range": `bytes ${start}-${end - 1}/${file.bytes.length}`,
          },
          body: new Uint8Array(file.bytes.subarray(start, end)),
          signal: AbortSignal.timeout(60000),
          redirect: "error",
        });
        if (!uploaded.ok)
          throw new DeliveryError(
            "failed",
            "The large attachment upload failed",
          );
      }
    }
    const response = await this.graph(
      `${mailbox}/messages/${encodeURIComponent(draft.id)}/send`,
      { method: "POST" },
      true,
      input.authorize,
    );
    return {
      id: response.headers.get("request-id") || draft.id,
      status: "accepted",
    };
  }
  async latestPdf(drive: string, folder: string, after: number) {
    let path = `/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(folder)}/children?$select=id,name,file,size,lastModifiedDateTime&$top=100`;
    const files: {
      id: string;
      name: string;
      size: number;
      file?: { mimeType: string };
      lastModifiedDateTime: string;
    }[] = [];
    for (let page = 0; path && page < 10; page++) {
      const result = (await (await this.graph(path)).json()) as {
        value: typeof files;
        "@odata.nextLink"?: string;
      };
      files.push(...result.value);
      const next = result["@odata.nextLink"];
      if (next && !next.startsWith("https://graph.microsoft.com/v1.0/"))
        throw new DeliveryError(
          "failed",
          "Unexpected Microsoft folder response",
        );
      path = next?.slice("https://graph.microsoft.com/v1.0".length) || "";
    }
    const file = files
      .filter(
        (item) =>
          item.file?.mimeType === "application/pdf" &&
          item.size <= 20 * 1024 * 1024 &&
          Date.parse(item.lastModifiedDateTime) >= after,
      )
      .sort((a, b) =>
        b.lastModifiedDateTime.localeCompare(a.lastModifiedDateTime),
      )[0];
    if (!file) return null;
    let response = await this.graph(
      `/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(file.id)}/content`,
    );
    if (response.status === 302) {
      const location = response.headers.get("location");
      if (!location || new URL(location).protocol !== "https:")
        throw new DeliveryError("failed", "Invalid Microsoft download link");
      response = await this.http(location, {
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
    }
    if (!response.ok)
      throw new DeliveryError(
        "failed",
        "The bulletin could not be downloaded from Microsoft",
      );
    return {
      id: file.id,
      name: file.name,
      bytes: await limitedBytes(response),
      modified: file.lastModifiedDateTime,
    };
  }
}
export class TwilioSmsProvider implements SmsProvider {
  private client: ReturnType<typeof twilio>;
  constructor(private config: NonNullable<ProviderConfig["twilio"]>) {
    this.client = twilio(config.accountSid, config.authToken, {
      autoRetry: false,
      timeout: 30000,
    });
  }
  async send(input: SmsDelivery): Promise<DeliveryResult> {
    if (input.authorize && !(await input.authorize()))
      throw new DeliveryError("skipped", "Consent or contact details changed");
    try {
      const message = await this.client.messages.create({
        from: this.config.from,
        to: input.to,
        body: input.body,
        statusCallback: input.statusCallback,
      });
      return { id: message.sid, status: "accepted" };
    } catch (error) {
      const status =
        error instanceof Error && "status" in error ? Number(error.status) : 0;
      const code =
        error instanceof Error && "code" in error ? Number(error.code) : 0;
      throw new DeliveryError(
        status >= 400 && status < 500 ? "failed" : "unknown",
        code === 21610
          ? "The phone number has opted out"
          : "Twilio did not accept or confirm this text. Check the provider log before retrying.",
      );
    }
  }
}
class FakeEmailProvider implements EmailProvider {
  async send(input: EmailDelivery): Promise<DeliveryResult> {
    if (input.authorize && !(await input.authorize()))
      throw new DeliveryError("skipped", "Consent changed");
    const id = `fake-${randomUUID()}`;
    await db
      .collection("emulatorDeliveries")
      .doc(id)
      .set({
        channel: "email",
        key: input.key,
        to: input.to,
        subject: input.subject,
        body: input.body,
        attachments: input.attachments.map((file) => ({
          name: file.name,
          size: file.bytes.length,
        })),
      });
    return { id, status: "simulated" };
  }
  async latestPdf(drive: string, folder: string, after: number) {
    const files = await db.collection("emulatorDriveFiles").get();
    const latest = files.docs
      .filter(
        (row) =>
          row.get("driveId") === drive &&
          row.get("folderId") === folder &&
          row.get("modifiedAt").toMillis() >= after,
      )
      .sort(
        (a, b) =>
          b.get("modifiedAt").toMillis() - a.get("modifiedAt").toMillis(),
      )[0];
    if (!latest) return null;
    const [bytes] = await getStorage()
      .bucket()
      .file(latest.get("path"))
      .download();
    return {
      id: latest.id,
      name: latest.get("name") as string,
      bytes,
      modified: latest.get("modifiedAt").toDate().toISOString(),
    };
  }
}
class FakeSmsProvider implements SmsProvider {
  async send(input: SmsDelivery): Promise<DeliveryResult> {
    if (input.authorize && !(await input.authorize()))
      throw new DeliveryError("skipped", "Consent changed");
    const id = `fake-${randomUUID()}`;
    await db
      .collection("emulatorDeliveries")
      .doc(id)
      .set({
        channel: "sms",
        key: input.key,
        to: input.to,
        body: input.body,
        statusCallback: input.statusCallback,
      });
    return { id, status: "simulated" };
  }
}
export function providers(): {
  email: EmailProvider | null;
  sms: SmsProvider | null;
} {
  if (emulatorMode())
    return { email: new FakeEmailProvider(), sms: new FakeSmsProvider() };
  const config = providerConfig();
  return {
    email: config.graph ? new GraphEmailProvider(config.graph) : null,
    sms: config.twilio ? new TwilioSmsProvider(config.twilio) : null,
  };
}
