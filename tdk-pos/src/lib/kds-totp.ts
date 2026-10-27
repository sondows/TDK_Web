import { createHmac, randomBytes } from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes: Buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += B32[(value << (5 - bits)) & 31];
  return output;
}
function decodeBase32(value: string) {
  let bits = 0, buffer = 0;
  const output: number[] = [];
  for (const char of value.toUpperCase().replace(/=+$/g, "")) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 TOTP secret.");
    buffer = (buffer << 5) | index; bits += 5;
    if (bits >= 8) { output.push((buffer >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(output);
}
export function newTotpSecret() { return base32(randomBytes(20)); }
export function verifyTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const key = decodeBase32(secret), counter = Math.floor(now / 30000);
  for (const drift of [-1, 0, 1]) {
    const data = Buffer.alloc(8); data.writeBigUInt64BE(BigInt(counter + drift));
    const digest = createHmac("sha1", key).update(data).digest(), offset = digest[digest.length - 1] & 15;
    const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
    if ((binary % 1_000_000).toString().padStart(6, "0") === code) return true;
  }
  return false;
}
