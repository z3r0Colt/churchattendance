import { describe, expect, it, vi } from "vitest";
import { GraphEmailProvider } from "./providers";
const config = {
  tenantId: "test-tenant",
  clientId: "test-client",
  clientSecret: "test-secret",
  mailbox: "office@example.test",
};
const token = () =>
  Response.json({ access_token: "fake-token", expires_in: 3600 });
const email = {
  key: "message-recipient-attempt",
  to: "alex@example.test",
  subject: "Church message",
  body: "Dear Alex",
  attachments: [],
};
describe("Microsoft Graph provider", () => {
  it("sends one recipient with application OAuth and reports acceptance, not delivery", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: { "request-id": "accepted-id" },
        }),
      );
    const provider = new GraphEmailProvider(config, http);
    expect(await provider.send(email)).toEqual({
      id: "accepted-id",
      status: "accepted",
    });
    const request = JSON.parse(String(http.mock.calls[1][1]?.body));
    expect(request.message.toRecipients).toEqual([
      { emailAddress: { address: email.to } },
    ]);
    expect(request.message.ccRecipients).toBeUndefined();
    expect(String(http.mock.calls[0][1]?.body)).toContain(
      "grant_type=client_credentials",
    );
  });
  it("uses a draft and upload session for a large PDF, without forwarding OAuth to its signed upload URL", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(Response.json({ id: "draft" }))
      .mockResolvedValueOnce(
        Response.json({ uploadUrl: "https://outlook.office.com/upload" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await new GraphEmailProvider(config, http).send({
      ...email,
      attachments: [
        { name: "bulletin.pdf", bytes: Buffer.alloc(4 * 1024 * 1024) },
      ],
    });
    expect(http.mock.calls[2][0]).toContain("createUploadSession");
    expect(http.mock.calls[3][1]?.headers).toMatchObject({
      "Content-Range": "bytes 0-3276799/4194304",
    });
    expect(http.mock.calls[3][1]?.headers).not.toHaveProperty("Authorization");
    expect(http.mock.calls[5][0]).toContain("/messages/draft/send");
  });
  it("checks consent after obtaining credentials and never sends after withdrawal", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(token());
    await expect(
      new GraphEmailProvider(config, http).send({
        ...email,
        authorize: async () => false,
      }),
    ).rejects.toMatchObject({ outcome: "skipped" });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("adds multiple small PDFs separately when their combined base64 would exceed the request limit", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(Response.json({ id: "draft" }))
      .mockResolvedValueOnce(Response.json({ id: "attachment-a" }))
      .mockResolvedValueOnce(Response.json({ id: "attachment-b" }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await new GraphEmailProvider(config, http).send({
      ...email,
      attachments: ["first.pdf", "second.pdf"].map((name) => ({
        name,
        bytes: Buffer.alloc(2_000_000),
      })),
    });
    expect(JSON.parse(String(http.mock.calls[1][1]?.body)).attachments).toEqual(
      [],
    );
    for (const call of http.mock.calls.slice(2, 4)) {
      expect(call[0]).toContain("/messages/draft/attachments");
      expect(Buffer.byteLength(String(call[1]?.body))).toBeLessThan(4_000_000);
    }
    expect(http.mock.calls[4][0]).toContain("/messages/draft/send");
  });
  it("marks an interrupted send unknown so the queue cannot blindly repeat it", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockRejectedValueOnce(new Error("network interrupted"));
    await expect(
      new GraphEmailProvider(config, http).send(email),
    ).rejects.toMatchObject({ outcome: "unknown" });
  });
  it("distinguishes a definite permission failure from an ambiguous server failure", async () => {
    for (const [status, outcome] of [
      [403, "failed"],
      [500, "unknown"],
    ] as const) {
      const http = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce(new Response(null, { status }));
      await expect(
        new GraphEmailProvider(config, http).send(email),
      ).rejects.toMatchObject({ outcome });
    }
  });
  it("follows only a Graph-provided HTTPS file download and chooses the newest PDF", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        Response.json({
          value: [
            {
              id: "old",
              name: "old.pdf",
              file: { mimeType: "application/pdf" },
              size: 20,
              lastModifiedDateTime: "2026-10-12T12:00:00Z",
            },
            {
              id: "new",
              name: "new.pdf",
              file: { mimeType: "application/pdf" },
              size: 30,
              lastModifiedDateTime: "2026-10-17T12:00:00Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://example.sharepoint.com/signed-file" },
        }),
      )
      .mockResolvedValueOnce(new Response("%PDF-fake"));
    const result = await new GraphEmailProvider(config, http).latestPdf(
      "drive",
      "folder",
      Date.parse("2026-10-12"),
    );
    expect(result?.name).toBe("new.pdf");
    expect(http.mock.calls[2][0]).toContain("/items/new/content");
    expect(http.mock.calls[3][1]?.headers).toBeUndefined();
  });
});
