import "server-only";

import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { and, eq, gt, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import { getCurrentProgramTrust } from "@/lib/program-trust";
import { isValidEmployeePin } from "@/lib/pin";

export const SESSION_COOKIE_NAME = "tdk_pos_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const configuredCookieSecure = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
export const sessionCookieSecure = configuredCookieSecure === "true"
  ? true
  : configuredCookieSecure === "false"
    ? false
    : process.env.NODE_ENV === "production";

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: sessionCookieSecure,
  maxAge: SESSION_MAX_AGE_SECONDS,
  path: "/",
};

export type CurrentStaff = {
  staffId: number;
  staffCode: string;
  loginId: string | null;
  name: string;
  role: "OWNER" | "MANAGER" | "STAFF";
};

function deriveScryptKey(pin: string, salt: string, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      pin,
      salt,
      64,
      { N: n, r, p, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

async function hashNumericPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await deriveScryptKey(pin, salt, 16384, 8, 1);

  return `scrypt$16384$8$1$${salt}$${derivedKey.toString("hex")}`;
}

export async function hashEmployeePin(pin: string) {
  if (!isValidEmployeePin(pin)) throw new Error("Employee PIN must contain exactly six digits.");
  return hashNumericPin(pin);
}

export async function verifyEmployeePin(pin: string, storedHash: string | null) {
  if (!storedHash || !isValidEmployeePin(pin)) return false;
  return verifyNumericPin(pin, storedHash);
}

export const isValidSecurityPassword = (password: string, minLength = 12) => password.length >= minLength && password.length <= 128;

/** Staff bootstrap password, separate from both the shared employee PIN and owner second factor. */
export const isValidProgramPassword = (password: string) =>
  password.length >= 10 && password.length <= 128 &&
  /[A-Za-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9\s]/.test(password);

export async function hashProgramPassword(password: string) {
  if (!isValidProgramPassword(password)) throw new Error("Invalid staff security password policy");
  return hashSecurityPassword(password, 10);
}

export async function hashSecurityPassword(password: string, minLength = 12) {
  if (!isValidSecurityPassword(password, minLength)) throw new Error(`Security password must contain ${minLength} to 128 characters.`);
  const salt = randomBytes(16).toString("hex");
  const key = await deriveScryptKey(password, salt, 16384, 8, 1);
  return `scrypt$16384$8$1$${salt}$${key.toString("hex")}`;
}

export async function verifySecurityPassword(password: string, storedHash: string | null) {
  if (!storedHash || typeof password !== "string" || password.length > 128) return false;
  return verifyNumericPin(password, storedHash);
}

export const isValidKdsPassword = (password: string) => password.length >= 12 && password.length <= 128;

export async function hashKdsPassword(password: string) {
  if (!isValidKdsPassword(password)) throw new Error("KDS onboarding password must be 12 to 128 characters.");
  const salt = randomBytes(16).toString("hex");
  const key = await deriveScryptKey(password, salt, 16384, 8, 1);
  return `scrypt$16384$8$1$${salt}$${key.toString("hex")}`;
}

export async function verifyKdsPassword(password: string, storedHash: string | null) {
  if (!storedHash || !isValidKdsPassword(password)) return false;
  return verifyNumericPin(password, storedHash);
}

async function verifyNumericPin(pin: string, storedHash: string) {

  const [algorithm, n, r, p, salt, expectedKey] = storedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    !n ||
    !r ||
    !p ||
    !salt ||
    !expectedKey
  ) {
    return false;
  }

  const expectedKeyBuffer = Buffer.from(expectedKey, "hex");
  if (expectedKeyBuffer.length !== 64) return false;

  const derivedKey = await deriveScryptKey(
    pin,
    salt,
    Number(n),
    Number(r),
    Number(p)
  );

  return timingSafeEqual(derivedKey, expectedKeyBuffer);
}

export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token || token.startsWith("admin.")) return null;

  const sessionCutoff = new Date(Date.now() - SESSION_MAX_AGE_SECONDS * 1000);
  const [currentStaff] = await db
    .select({
      staffId: staff.staffId,
      staffCode: staff.staffCode,
      loginId: staff.adminLoginId,
      name: staff.name,
      role: staff.role,
      managedDeviceId: staffSessions.managedDeviceId,
      trustTokenId: staffSessions.trustTokenId,
    })
    .from(staffSessions)
    .innerJoin(staff, eq(staffSessions.staffId, staff.staffId))
    .where(
      and(
        eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
        eq(staffSessions.status, "ACTIVE"),
        eq(staffSessions.sessionType, "POS"),
        eq(staff.isActive, 1),
        eq(staff.posEnabled, 1),
        ne(staff.staffCode, "000"),
        gt(staffSessions.loggedInAt, sessionCutoff)
      )
    )
    .limit(1);

  if (!currentStaff) return null;
  const member: CurrentStaff = {
    staffId: currentStaff.staffId,
    staffCode: currentStaff.staffCode,
    loginId: currentStaff.loginId,
    name: currentStaff.name,
    role: currentStaff.role,
  };
  const trust = await getCurrentProgramTrust("POS", { tokenId: currentStaff.trustTokenId ?? undefined });
  return trust && currentStaff.trustTokenId === trust.tokenId ? member : null;
}

/** Verifies a real active employee without creating a browser login session. */
export async function verifyActiveStaffCredentials(
  loginId: string | number,
  pin: string,
  _options: { allowShared?: boolean } = {},
): Promise<CurrentStaff | null> {
  void _options;
  const numericId = typeof loginId === "number" ? loginId : null;
  const normalizedLoginId = typeof loginId === "string" ? loginId.trim().toLowerCase() : "";
  if ((!normalizedLoginId && (numericId === null || !Number.isSafeInteger(numericId) || numericId <= 0)) || !pin) return null;

  const [candidate] = await db
    .select({
      staffId: staff.staffId,
      staffCode: staff.staffCode,
      adminLoginId: staff.adminLoginId,
      name: staff.name,
      role: staff.role,
      posEnabled: staff.posEnabled,
      employeePinHash: staff.employeePinHash,
    })
    .from(staff)
    .where(and(numericId ? eq(staff.staffId, numericId) : sql`LOWER(${staff.adminLoginId}) = ${normalizedLoginId}`, eq(staff.isActive, 1), ne(staff.staffCode, "000")))
    .limit(1);

  if (!candidate || candidate.posEnabled !== 1 || !candidate.employeePinHash || !(await verifyEmployeePin(pin, candidate.employeePinHash))) return null;
  return { staffId: candidate.staffId, staffCode: candidate.staffCode, loginId: candidate.adminLoginId, name: candidate.name, role: candidate.role };
}
