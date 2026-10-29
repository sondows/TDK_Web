import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { kdsAuthIpAttempts, managedDevices } from "@/db/schema";
import { sessionCookieSecure } from "@/lib/auth";
import { isExternalAdminHost } from "@/lib/host-access";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
export { newTotpSecret, verifyTotp } from "@/lib/kds-totp";

export const KDS_DEVICE_COOKIE = "tdk_kds_device";
export const ADM_DEVICE_COOKIE = "tdk_adm_device";
export const POS_DEVICE_COOKIE = "tdk_pos_device";
export const KDS_DEVICE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const kdsDeviceCookieOptions = {
  httpOnly: true, secure: sessionCookieSecure, sameSite: "lax" as const,
  path: "/", maxAge: KDS_DEVICE_MAX_AGE_SECONDS,
};
export function kdsCookieSecureForRequest(request: Request) {
  return sessionCookieSecure || isExternalAdminHost(request.headers.get("host"));
}

function encryptionKey() {
  const key = Buffer.from(process.env.KDS_TOTP_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("KDS_TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}
export function encryptTotpSecret(secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
export function decryptTotpSecret(value: string) {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) throw new Error("Invalid encrypted TOTP secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

export function hashKdsDeviceToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function createKdsDeviceToken() { return randomBytes(32).toString("base64url"); }
export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin"), host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { return false; }
}
export async function getCurrentDeviceRegistration(cookieName = KDS_DEVICE_COOKIE, expectedType?: "POS" | "ADM" | "KDS" | "HOS") {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const tokenHash = hashKdsDeviceToken(token);
  const [device] = await db.select({
    deviceId: managedDevices.deviceId,
    deviceCode: managedDevices.deviceCode,
    deviceName: managedDevices.deviceName,
    deviceType: managedDevices.deviceType,
    kdsEnabled: managedDevices.kdsEnabled,
    status: managedDevices.status,
    confirmationCode: managedDevices.confirmationCode,
    requestExpiresAt: managedDevices.requestExpiresAt,
    expiresAt: managedDevices.expiresAt,
  }).from(managedDevices).where(and(or(
    eq(managedDevices.requestTokenHash, tokenHash), eq(managedDevices.tokenHash, tokenHash),
  ), ...(expectedType ? [eq(managedDevices.deviceType, expectedType)] : []))).limit(1);
  return device ? { token, device } : null;
}
export async function getCurrentKdsDevice() {
  const token = (await cookies()).get(KDS_DEVICE_COOKIE)?.value;
  if (!token) return null;
  const [device] = await db.select({ deviceId: managedDevices.deviceId, lastUsedAt: managedDevices.lastUsedAt }).from(managedDevices).where(and(
    eq(managedDevices.tokenHash, hashKdsDeviceToken(token)), eq(managedDevices.status, "APPROVED"),
    eq(managedDevices.kdsEnabled, 1), sql`${managedDevices.expiresAt} > NOW()`,
  )).limit(1);
  if (device && (!device.lastUsedAt || Date.now() - device.lastUsedAt.getTime() > 5 * 60 * 1000)) {
    await db.update(managedDevices).set({ lastUsedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
  }
  return device ?? null;
}

export async function getCurrentAdmDevice() {
  const token = (await cookies()).get(ADM_DEVICE_COOKIE)?.value;
  if (!token) return null;
  const [device] = await db.select({ deviceId: managedDevices.deviceId, lastUsedAt: managedDevices.lastUsedAt,
    expiresAt: managedDevices.expiresAt }).from(managedDevices).where(and(
      eq(managedDevices.tokenHash, hashKdsDeviceToken(token)),
      eq(managedDevices.deviceType, "ADM"), eq(managedDevices.status, "APPROVED"),
      eq(managedDevices.admEnabled, 1),
    )).limit(1);
  if (!device || !device.expiresAt || device.expiresAt.getTime() <= Date.now()) return null;
  if (!device.lastUsedAt || Date.now() - device.lastUsedAt.getTime() > 5 * 60 * 1000) {
    await db.update(managedDevices).set({ lastUsedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
  }
  return { deviceId: device.deviceId, lastUsedAt: device.lastUsedAt };
}

export async function getCurrentPosDevice() {
  const token = (await cookies()).get(POS_DEVICE_COOKIE)?.value;
  if (!token) return null;
  const [device] = await db.select({ deviceId: managedDevices.deviceId, lastUsedAt: managedDevices.lastUsedAt,
    expiresAt: managedDevices.expiresAt }).from(managedDevices).where(and(
      eq(managedDevices.tokenHash, hashKdsDeviceToken(token)),
      eq(managedDevices.deviceType, "POS"), eq(managedDevices.status, "APPROVED"),
      eq(managedDevices.posEnabled, 1),
    )).limit(1);
  if (!device || !device.expiresAt || device.expiresAt.getTime() <= Date.now()) return null;
  if (!device.lastUsedAt || Date.now() - device.lastUsedAt.getTime() > 5 * 60 * 1000) {
    await db.update(managedDevices).set({ lastUsedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
  }
  return { deviceId: device.deviceId, lastUsedAt: device.lastUsedAt };
}

export async function reserveKdsIpAttempt() {
  const clientIp = await getKdsRateLimitIp();
  const ipHash = createHash("sha256").update(clientIp ?? "unverified-client-ip").digest("hex");
  await db.delete(kdsAuthIpAttempts).where(sql`${kdsAuthIpAttempts.updatedAt} < DATE_SUB(NOW(), INTERVAL 1 DAY)`);
  const expired = sql`${kdsAuthIpAttempts.windowStartedAt} <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`;
  await db.insert(kdsAuthIpAttempts).values({ ipHash, windowStartedAt: new Date(), attemptCount: 1 }).onDuplicateKeyUpdate({
    set: {
      attemptCount: sql`IF(${expired}, 1, ${kdsAuthIpAttempts.attemptCount} + 1)`,
      windowStartedAt: sql`IF(${expired}, NOW(), ${kdsAuthIpAttempts.windowStartedAt})`,
      updatedAt: sql`NOW()`,
    },
  });
  const [row] = await db.select({ attemptCount: kdsAuthIpAttempts.attemptCount }).from(kdsAuthIpAttempts).where(eq(kdsAuthIpAttempts.ipHash, ipHash)).limit(1);
  return Boolean(row && row.attemptCount <= 30);
}
