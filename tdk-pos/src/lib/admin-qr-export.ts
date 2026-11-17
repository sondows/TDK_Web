import QRCode from "qrcode";

export type QrPngBackground = "transparent" | "white";
export type QrZipEntry = { fileName: string; targetUrl: string };

export function publicQrUrl(request: Request, identifier: string): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const baseUrl = process.env.QR_PUBLIC_BASE_URL?.trim()
    || (host ? `${forwardedProto || new URL(request.url).protocol.replace(":", "")}://${host}` : new URL(request.url).origin);
  return new URL(`/q/${identifier}`, baseUrl).toString();
}

export function parseQrPngBackground(value: string | null): QrPngBackground | null {
  if (value === null || value === "transparent") return "transparent";
  return value === "white" ? "white" : null;
}

export function renderAdminQrPng(targetUrl: string, background: QrPngBackground): Promise<Buffer> {
  return QRCode.toBuffer(targetUrl, {
    type: "png",
    width: 1000,
    margin: 4,
    errorCorrectionLevel: "H",
    color: { dark: "#000000FF", light: background === "white" ? "#FFFFFFFF" : "#FFFFFF00" },
  });
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(now: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, now.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
  };
}

function localFileHeader(name: Uint8Array, data: Uint8Array, checksum: number, date: number, time: number): Uint8Array {
  const bytes = new Uint8Array(30 + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  bytes.set(name, 30);
  return bytes;
}

function centralDirectoryHeader(name: Uint8Array, data: Uint8Array, checksum: number, date: number, time: number, offset: number): Uint8Array {
  const bytes = new Uint8Array(46 + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, data.length, true);
  view.setUint32(24, data.length, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  bytes.set(name, 46);
  return bytes;
}

export function createQrZipStream(entries: QrZipEntry[], background: QrPngBackground): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const centralDirectory: Uint8Array[] = [];
  let entryIndex = 0;
  let offset = 0;
  let centralDirectorySize = 0;
  const timestamp = dosDateTime(new Date());

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (entryIndex < entries.length) {
          const entry = entries[entryIndex];
          const name = encoder.encode(entry.fileName);
          const png = await renderAdminQrPng(entry.targetUrl, background);
          const checksum = crc32(png);
          const header = localFileHeader(name, png, checksum, timestamp.date, timestamp.time);
          const central = centralDirectoryHeader(name, png, checksum, timestamp.date, timestamp.time, offset);
          controller.enqueue(header);
          controller.enqueue(png);
          offset += header.length + png.length;
          centralDirectorySize += central.length;
          centralDirectory.push(central);
          entryIndex += 1;
          return;
        }

        const end = new Uint8Array(22);
        const view = new DataView(end.buffer);
        view.setUint32(0, 0x06054b50, true);
        view.setUint16(4, 0, true);
        view.setUint16(6, 0, true);
        view.setUint16(8, entries.length, true);
        view.setUint16(10, entries.length, true);
        view.setUint32(12, centralDirectorySize, true);
        view.setUint32(16, offset, true);
        view.setUint16(20, 0, true);
        for (const header of centralDirectory) controller.enqueue(header);
        controller.enqueue(end);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
