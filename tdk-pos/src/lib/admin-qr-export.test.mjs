import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createQrZipStream, renderAdminQrPng } from "./admin-qr-export.ts";

test("PNG export renders at the requested 1000 by 1000 pixel size", async () => {
  const png = await renderAdminQrPng("https://example.test/q/0123456789abcdef", "transparent");
  assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1000);
  assert.equal(png.readUInt32BE(20), 1000);
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, "transparent export keeps the quiet zone transparent");
  const whitePng = await renderAdminQrPng("https://example.test/q/0123456789abcdef", "white");
  const { data: whiteData } = await sharp(whitePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(whiteData[3], 255, "white export has an opaque background");
});

test("ZIP export contains the management-number PNG filename and ZIP directory", async () => {
  const stream = createQrZipStream([{ fileName: "20261116-0001.png", targetUrl: "https://example.test/q/0123456789abcdef" }], "white");
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  const archive = Buffer.concat(chunks);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.match(archive.toString("latin1"), /20261116-0001\.png/);
  const localNameLength = archive.readUInt16LE(26);
  const localExtraLength = archive.readUInt16LE(28);
  const pngOffset = 30 + localNameLength + localExtraLength;
  assert.equal(archive.toString("hex", pngOffset, pngOffset + 8), "89504e470d0a1a0a");
  const endOffset = archive.length - 22;
  assert.equal(archive.readUInt32LE(endOffset), 0x06054b50);
  assert.equal(archive.readUInt16LE(endOffset + 10), 1);
  assert.equal(archive.readUInt32LE(archive.readUInt32LE(endOffset + 16)), 0x02014b50);
});
