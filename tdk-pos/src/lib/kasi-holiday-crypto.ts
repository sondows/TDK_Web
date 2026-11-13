import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const AAD = Buffer.from("tdkon:kasi-holiday-api-key:v1", "utf8");
const ENVELOPE_PREFIX = "v1";

export function encryptKasiServiceKey(plainText: string, masterKey: Buffer) {
  if (masterKey.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const envelope = [ENVELOPE_PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  if (envelope.length > 255) throw new Error("ENCRYPTED_VALUE_TOO_LARGE");
  return envelope;
}

export function decryptKasiServiceKey(envelope: string, masterKey: Buffer) {
  if (masterKey.length !== 32) throw new Error("Invalid master key length.");
  const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split(".");
  if (version !== ENVELOPE_PREFIX || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) throw new Error("Invalid encrypted value.");
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const ciphertext = Buffer.from(ciphertextValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Invalid encrypted value.");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
