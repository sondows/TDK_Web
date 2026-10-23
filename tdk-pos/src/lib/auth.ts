import "server-only";

import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import { isValidPin } from "@/lib/pin";

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

export async function hashPin(pin: string) {
  if (!isValidPin(pin)) throw new Error("PIN은 숫자 4자리여야 합니다.");
  return hashNumericPin(pin);
}

async function hashNumericPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await deriveScryptKey(pin, salt, 16384, 8, 1);

  return `scrypt$16384$8$1$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPin(pin: string, storedHash: string | null) {
  if (!storedHash || !isValidPin(pin)) return false;
  return verifyNumericPin(pin, storedHash);
}

export const isValidAdminPin = (pin: string) => /^\d{6}$/.test(pin);

export async function hashAdminPin(pin: string) {
  if (!isValidAdminPin(pin)) throw new Error("관리센터 PIN은 숫자 6자리여야 합니다.");
  return hashNumericPin(pin);
}

export async function verifyAdminPin(pin: string, storedHash: string | null) {
  if (!storedHash || !isValidAdminPin(pin)) return false;
  return verifyNumericPin(pin, storedHash);
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
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token || token.startsWith("admin.")) return null;

  const sessionCutoff = new Date(Date.now() - SESSION_MAX_AGE_SECONDS * 1000);
  const [currentStaff] = await db
    .select({
      staffId: staff.staffId,
      staffCode: staff.staffCode,
      name: staff.name,
      role: staff.role,
    })
    .from(staffSessions)
    .innerJoin(staff, eq(staffSessions.staffId, staff.staffId))
    .where(
      and(
        eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
        eq(staffSessions.status, "ACTIVE"),
        eq(staff.isActive, 1),
        gt(staffSessions.loggedInAt, sessionCutoff)
      )
    )
    .limit(1);

  return currentStaff ?? null;
}

/** Verifies a real active employee without creating a browser login session. */
export async function verifyActiveStaffCredentials(
  staffCode: string,
  pin: string,
  { allowShared = false }: { allowShared?: boolean } = {},
): Promise<CurrentStaff | null> {
  const normalizedCode = staffCode.trim();
  if (!normalizedCode || !pin || (normalizedCode === "000" && !allowShared)) return null;

  const [candidate] = await db
    .select({
      staffId: staff.staffId,
      staffCode: staff.staffCode,
      name: staff.name,
      role: staff.role,
      pinHash: staff.pinHash,
    })
    .from(staff)
    .where(and(eq(staff.staffCode, normalizedCode), eq(staff.isActive, 1)))
    .limit(1);

  if (!candidate || !(await verifyPin(pin, candidate.pinHash))) return null;
  return { staffId: candidate.staffId, staffCode: candidate.staffCode, name: candidate.name, role: candidate.role };
}
