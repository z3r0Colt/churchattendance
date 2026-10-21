import { deflateSync } from "node:zlib";
import { onRequest } from "firebase-functions/v2/https";
import { brandPalettes } from "@sycamore/shared";
import { readPublicBranding } from "./branding.js";
function crc(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer) {
  const type = Buffer.from(name), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, checksum]);
}
function icon(size: number, color: string) {
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  const pixels = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = x / size, b = y / size;
    const roof = b > 0.32 && b < 0.55 && Math.abs(a - 0.5) < (b - 0.32) * 1.25;
    const body = a > 0.28 && a < 0.72 && b >= 0.55 && b < 0.8;
    const door = a > 0.46 && a < 0.54 && b > 0.65;
    const cross = (Math.abs(a - 0.5) < 0.017 && b > 0.16 && b < 0.34) || (Math.abs(b - 0.23) < 0.017 && a > 0.43 && a < 0.57);
    const foreground = (roof || body || cross) && !door;
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    for (let c = 0; c < 3; c++) pixels[offset + c] = foreground ? 255 : rgb[c];
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
export const pwaManifest = onRequest(async (_request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const branding = await readPublicBranding();
    response.type("application/manifest+json").send({
      id: "/", scope: "/", start_url: "/launch", name: branding.appName, short_name: branding.appName.slice(0, 30),
      description: branding.subtitle || branding.churchName, display: "standalone", background_color: "#ffffff",
      theme_color: brandPalettes[branding.palette].light,
      icons: [
        ...[192, 512].map((size) => ({ src: `/app-icon.png?size=${size}`, sizes: `${size}x${size}`, type: "image/png", purpose: branding.logo ? "maskable" : "any maskable" })),
        ...(branding.logo ? (() => {
          const png = Buffer.from(branding.logo.split(",")[1], "base64");
          return [{ src: "/app-icon.png?logo=1", sizes: `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, type: "image/png", purpose: "any" }];
        })() : []),
      ],
    });
  } catch { response.status(503).send("Church configuration unavailable"); }
});
export const pwaIcon = onRequest(async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const branding = await readPublicBranding();
    if (request.query.logo === "1" && branding.logo) { response.type("png").send(Buffer.from(branding.logo.split(",")[1], "base64")); return; }
    const size = request.query.size === "192" ? 192 : 512;
    response.type("png").send(icon(size, brandPalettes[branding.palette].light));
  } catch { response.status(503).send("Church configuration unavailable"); }
});
