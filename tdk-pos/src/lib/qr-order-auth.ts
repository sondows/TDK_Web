import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2/promise";
import { db, pool } from "@/db";
import { diningTables, qrCodes, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";

export const QR_ORDER_ACCESS_COOKIE = "tdkon_qr_session";
export const QR_ORDER_ACCESS_MAX_AGE_SECONDS = 12 * 60 * 60;
export const QR_DEV_TEST_COOKIE = "tdkon_qr_dev_test";
export const QR_DEV_TEST_TOKEN_PREFIX = "devtest_";
export const QR_DEV_TEST_MAX_AGE_SECONDS = 30 * 60;
const QR_IDENTIFIER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function createQrIdentifier() {
  return Array.from({ length: 16 }, () => QR_IDENTIFIER_ALPHABET[randomInt(QR_IDENTIFIER_ALPHABET.length)]).join("");
}

export function createQrAccessToken() {
  return randomBytes(32).toString("base64url");
}

export function createQrDevTestToken() {
  return `${QR_DEV_TEST_TOKEN_PREFIX}${createQrAccessToken()}`;
}

export async function isDevelopmentQrTestDatabase() {
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const [rows] = await pool.query<(RowDataPacket & { databaseName: string | null })[]>("SELECT DATABASE() AS databaseName");
    return rows[0]?.databaseName === "TDK_POS_TEST";
  } catch {
    return false;
  }
}

export function hashQrToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function validQrAccessToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

export function qrSessionCookieAttributes(request: Request, maxAgeSeconds = QR_ORDER_ACCESS_MAX_AGE_SECONDS) {
  const secure = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https" || new URL(request.url).protocol === "https:";
  return `Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export async function getQrAccessTokenFromCookies() {
  return (await cookies()).get(QR_ORDER_ACCESS_COOKIE)?.value ?? null;
}

export async function resolveQrOrderSession(token: unknown) {
  if (!validQrAccessToken(token) || token.startsWith(QR_DEV_TEST_TOKEN_PREFIX)) return null;
  return resolveQrOrderToken(token);
}

async function resolveQrOrderToken(token: string, testSession = false) {
  if (testSession && !(await isDevelopmentQrTestDatabase())) return null;
  const tokenHash = hashQrToken(token);
  const whereConditions = [
    eq(qrSessions.tokenHash, tokenHash),
    eq(qrSessions.status, "ACTIVE"),
    or(isNull(qrSessions.sessionId), and(eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN")))!,
    eq(qrCodes.targetType, "TABLE_ORDER"),
    eq(qrCodes.status, "IN_USE"),
    eq(diningTables.isActive, 1),
  ];
  whereConditions.push(sql`${qrSessions.createdAt} >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${testSession ? QR_DEV_TEST_MAX_AGE_SECONDS : QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND)`);
  const [row] = await db.select({
    qrSessionId: qrSessions.qrSessionId,
    sessionId: qrSessions.sessionId,
    languageCode: qrSessions.languageCode,
    createdAt: qrSessions.createdAt,
    qrTableId: qrSessions.tableId,
    tableId: diningTables.tableId,
    tableNo: diningTables.tableNo,
    capacity: diningTables.capacity,
  }).from(qrSessions)
    .leftJoin(tableSessions, eq(tableSessions.sessionId, qrSessions.sessionId))
    .innerJoin(diningTables, eq(diningTables.tableId, sql`COALESCE(${tableSessions.tableId}, ${qrSessions.tableId})`))
    .innerJoin(qrTableLinks, eq(qrTableLinks.tableId, diningTables.tableId))
    .innerJoin(qrCodes, eq(qrCodes.qrCodeId, qrTableLinks.qrCodeId))
    .where(and(...whereConditions)).limit(1);
  if (!row?.qrSessionId) return null;
  await db.update(qrSessions).set({ lastActiveAt: new Date() }).where(eq(qrSessions.qrSessionId, row.qrSessionId));
  return { ...row, isTest: testSession, canViewOrders: row.sessionId !== null, sessionId: row.sessionId === null ? null : Number(row.sessionId), qrSessionId: Number(row.qrSessionId), tableId: Number(row.tableId), capacity: Number(row.capacity) };
}

export async function resolveQrDevTestSession(token: unknown) {
  if (!validQrAccessToken(token) || !token.startsWith(QR_DEV_TEST_TOKEN_PREFIX)) return null;
  return resolveQrOrderToken(token, true);
}

export async function resolveQrOrderRequest(request: Request) {
  const testPrefix = `${QR_DEV_TEST_COOKIE}=`;
  const rawTest = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(testPrefix));
  if (rawTest) {
    let testToken: string | null = null;
    try { testToken = decodeURIComponent(rawTest.slice(testPrefix.length)); } catch { return null; }
    return resolveQrDevTestSession(testToken);
  }
  const prefix = `${QR_ORDER_ACCESS_COOKIE}=`;
  const raw = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(prefix));
  let token: string | null = null;
  try { token = raw ? decodeURIComponent(raw.slice(prefix.length)) : null; } catch { return null; }
  return resolveQrOrderSession(token);
}
