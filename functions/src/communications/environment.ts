import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
export const communicationSecret = defineSecret("COMMUNICATIONS_CONFIG");
export const emulatorMode = () => process.env.FUNCTIONS_EMULATOR === "true";
const configSchema = z
  .object({
    publicFunctionsUrl: z.url().refine((value) => value.startsWith("https://")),
    unsubscribeSecret: z.string().min(32),
    graph: z
      .object({
        tenantId: z.string().min(1),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        mailbox: z.email(),
      })
      .optional(),
    twilio: z
      .object({
        accountSid: z.string().regex(/^AC[a-fA-F0-9]{32}$/),
        authToken: z.string().min(16),
        from: z.string().regex(/^\+[1-9]\d{7,14}$/),
      })
      .optional(),
  })
  .strict();
export type ProviderConfig = z.infer<typeof configSchema>;
export function providerConfig(): ProviderConfig {
  if (emulatorMode())
    return {
      publicFunctionsUrl: `http://127.0.0.1:5001/${process.env.GCLOUD_PROJECT || "demo-sycamore"}/us-central1`,
      unsubscribeSecret: "local-emulator-only-not-a-production-secret",
      graph: {
        tenantId: "demo",
        clientId: "demo",
        clientSecret: "demo",
        mailbox: "office@example.test",
      },
      twilio: {
        accountSid: `AC${"0".repeat(32)}`,
        authToken: "local-emulator-twilio-token",
        from: "+15555550100",
      },
    };
  try {
    return configSchema.parse(JSON.parse(communicationSecret.value()));
  } catch {
    throw new Error(
      "Communication credentials have not been configured correctly",
    );
  }
}
