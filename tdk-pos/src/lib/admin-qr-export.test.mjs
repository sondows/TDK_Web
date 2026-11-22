import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import { createQrZipStream, publicQrUrl, renderAdminQrPng } from "./admin-qr-export.ts";

function withPublicBaseUrl(value, run) {
  const previousBaseUrl = process.env.QR_PUBLIC_BASE_URL;
  if (value === undefined) delete process.env.QR_PUBLIC_BASE_URL;
  else process.env.QR_PUBLIC_BASE_URL = value;
  try {
    return run();
  } finally {
    if (previousBaseUrl === undefined) delete process.env.QR_PUBLIC_BASE_URL;
    else process.env.QR_PUBLIC_BASE_URL = previousBaseUrl;
  }
}

test("table QR URL always uses the public HTTPS origin when config is missing", () => {
  withPublicBaseUrl(undefined, () => {
    assert.equal(publicQrUrl("23456789ABCDEFGH"), "https://tdkon.myasustor.com/q/23456789ABCDEFGH");
  });
});

test("table QR URL accepts only the configured canonical HTTPS origin", () => {
  withPublicBaseUrl("https://tdkon.myasustor.com/", () => {
    assert.equal(publicQrUrl("23456789ABCDEFGH"), "https://tdkon.myasustor.com/q/23456789ABCDEFGH");
  });
  for (const invalid of ["http://tdkon.myasustor.com", "http://192.168.0.83", "https://192.168.0.83",
    "https://tdkon.myasustor.com.evil.example", "https://tdkon.myasustor.com/other",
    "https://user:pass@tdkon.myasustor.com", "not a url"]) {
    withPublicBaseUrl(invalid, () => assert.throws(() => publicQrUrl("23456789ABCDEFGH"), /QR_PUBLIC_BASE_URL/));
  }
});

test("SVG and PNG render from the canonical URL", async () => {
  const url = withPublicBaseUrl(undefined, () => publicQrUrl("23456789ABCDEFGH"));
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 320 });
  const png = await renderAdminQrPng(url, "white");
  assert.match(svg, /<svg/);
  assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a");
});

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
