import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, getTableColumns, getTableName, isNull, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2/promise";
import { db, pool } from "@/db";
import { checkouts, diningTables, orders, paymentSessionAllocations, payments, qrCodes, qrOrderAuthAttempts, qrSessions, qrTableLinks, qrTableOrderClaims, tableSessions, tvQrAuthCodeState } from "@/db/schema";
import { QR_ORDER_ACCESS_MAX_AGE_SECONDS, qrTableSessionExpiresAtSql } from "@/lib/qr-session-expiry-policy";
import { classifyQrOrderAccessState } from "@/lib/qr-order-access-state";
import { qrCustomerRedirectUrl } from "@/lib/qr-customer-redirect";
import { expectedQrOrderAuthDatabase, resolveQrOrderAuthAvailability } from "@/lib/qr-order-auth-attempt-policy";

export { QR_ORDER_ACCESS_MAX_AGE_SECONDS } from "@/lib/qr-session-expiry-policy";

export const QR_ORDER_ACCESS_COOKIE = "tdkon_qr_session";
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

export const QR_ORDER_AUTH_UNAVAILABLE_MESSAGE = "QR 주문 인증을 사용할 수 없습니다. 직원에게 문의해 주세요.";

const authSchemaColumns = [qrTableOrderClaims, qrOrderAuthAttempts, tvQrAuthCodeState].map(table =>
  [getTableName(table), Object.values(getTableColumns(table)).map(column => column.name)] as const);
const authSchemaConditions = authSchemaColumns.map(() => "(TABLE_NAME=? AND COLUMN_NAME IN (?))").join(" OR ");
const expectedAuthColumnCount = authSchemaColumns.reduce((count, [, columns]) => count + columns.length, 0);

export async function getQrOrderAuthAvailability(): Promise<ReturnType<typeof resolveQrOrderAuthAvailability>> {
  const { NODE_ENV, DB_NAME, TDK_QR_ORDER_AUTH_TEST_OFF } = process.env;
  const expected = expectedQrOrderAuthDatabase(NODE_ENV);
  if (!expected || DB_NAME !== expected) return "UNAVAILABLE";
  try {
    const [rows] = await pool.query<(RowDataPacket & { databaseName: string | null; schemaColumns: number; tvStateReady: number })[]>(`
      SELECT DATABASE() AS databaseName,
        (SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND (${authSchemaConditions})) AS schemaColumns,
        EXISTS (SELECT 1 FROM tv_qr_auth_code_state WHERE state_id=1) AS tvStateReady`, authSchemaColumns.flatMap(([table, columns]) => [table, columns]));
    return resolveQrOrderAuthAvailability(NODE_ENV, DB_NAME, rows[0]?.databaseName,
      Number(rows[0]?.schemaColumns) === expectedAuthColumnCount, Number(rows[0]?.tvStateReady) === 1,
      TDK_QR_ORDER_AUTH_TEST_OFF);
  } catch { return "UNAVAILABLE"; }
}

export async function getQrOrderAuthApiError() {
  const availability = await getQrOrderAuthAvailability();
  const headers = { "Cache-Control": "no-store" };
  if (availability === "TEST_OFF") return Response.json({ success: false }, { status: 404, headers });
  if (availability === "UNAVAILABLE") return Response.json({
    success: false, code: "QR_AUTH_UNAVAILABLE", message: QR_ORDER_AUTH_UNAVAILABLE_MESSAGE,
  }, { status: 503, headers });
  return null;
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

export function qrSessionRedirectResponse(request: Request, destination: string, token: string, maxAgeSeconds = QR_ORDER_ACCESS_MAX_AGE_SECONDS) {
  return new Response(null, { status: 302, headers: {
    Location: qrCustomerRedirectUrl(request, destination).toString(),
    "Set-Cookie": `${QR_ORDER_ACCESS_COOKIE}=${encodeURIComponent(token)}; ${qrSessionCookieAttributes(request, maxAgeSeconds)}`,
  } });
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
    eq(diningTables.isActive, 1),
  ];
  const tokenLifetime = sql`${qrSessions.createdAt} >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${testSession ? QR_DEV_TEST_MAX_AGE_SECONDS : QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND)`;
  if (testSession) {
    whereConditions.push(tokenLifetime);
    whereConditions.push(or(isNull(qrSessions.sessionId), sql`${qrTableSessionExpiresAtSql(qrSessions.sessionId)} > CURRENT_TIMESTAMP`)!);
  } else {
    // Bound customer tokens share the end time of the session that accepted
    // the first QR order; a later invitee cannot extend that table session.
    whereConditions.push(or(
      and(isNull(qrSessions.sessionId), tokenLifetime),
      sql`${qrSessions.sessionId} IS NOT NULL AND ${qrTableSessionExpiresAtSql(qrSessions.sessionId)} > CURRENT_TIMESTAMP`
    )!);
  }
  const [row] = await db.select({
    qrSessionId: qrSessions.qrSessionId,
    sessionId: qrSessions.sessionId,
    languageCode: qrSessions.languageCode,
    createdAt: qrSessions.createdAt,
    qrTableId: qrSessions.tableId,
    canViewOrders: sql<boolean>`CASE
      WHEN ${qrSessions.tableId} <> ${tableSessions.tableId} THEN FALSE
      WHEN ${qrSessions.accessGrantSource} = 'ORDER_APPROVED' THEN EXISTS (
        SELECT 1 FROM qr_orders proof_order
        JOIN orders proof_pos ON proof_pos.order_id = proof_order.accepted_order_id
        WHERE proof_order.qr_order_id = ${qrSessions.accessGrantQrOrderId}
          AND proof_order.qr_session_id = ${qrSessions.qrSessionId}
          AND proof_order.status = 'ACCEPTED'
          AND proof_pos.session_id = ${qrSessions.sessionId})
      WHEN ${qrSessions.accessGrantSource} = 'INVITED' THEN EXISTS (
        SELECT 1 FROM qr_session_invites proof_invite
        WHERE proof_invite.invite_id = ${qrSessions.accessGrantInviteId}
          AND proof_invite.session_id = ${qrSessions.sessionId}
          AND proof_invite.redeemed_at IS NOT NULL)
      WHEN ${qrSessions.accessGrantSource} = 'LEGACY'
        THEN ${qrSessions.accessGrantedAt} IS NOT NULL
      ELSE FALSE END`,
    tableId: diningTables.tableId,
    tableNo: diningTables.tableNo,
    capacity: diningTables.capacity,
  }).from(qrSessions)
    .leftJoin(tableSessions, eq(tableSessions.sessionId, qrSessions.sessionId))
    .innerJoin(diningTables, eq(diningTables.tableId, sql`COALESCE(${tableSessions.tableId}, ${qrSessions.tableId})`))
    .leftJoin(qrTableLinks, eq(qrTableLinks.tableId, diningTables.tableId))
    .leftJoin(qrCodes, eq(qrCodes.qrCodeId, qrTableLinks.qrCodeId))
    .where(and(...whereConditions, or(
      and(isNull(qrSessions.sessionId), eq(qrCodes.targetType, "TABLE_ORDER"), eq(qrCodes.status, "IN_USE")),
      and(sql`${qrSessions.sessionId} IS NOT NULL`, eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN"))
    )!)).limit(1);
  if (!row?.qrSessionId) return null;
  await db.update(qrSessions).set({ lastActiveAt: new Date() }).where(eq(qrSessions.qrSessionId, row.qrSessionId));
  return { ...row, isTest: testSession, canViewOrders: Boolean(row.canViewOrders), sessionId: row.sessionId === null ? null : Number(row.sessionId), qrSessionId: Number(row.qrSessionId), tableId: Number(row.tableId), capacity: Number(row.capacity) };
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
    try { testToken = decodeURIComponent(rawTest.slice(testPrefix.length)); } catch { /* Ignore malformed or stale test cookies and check the customer token below. */ }
    const testSession = await resolveQrDevTestSession(testToken);
    if (testSession) return testSession;
  }
  const prefix = `${QR_ORDER_ACCESS_COOKIE}=`;
  const raw = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(prefix));
  let token: string | null = null;
  try { token = raw ? decodeURIComponent(raw.slice(prefix.length)) : null; } catch { return null; }
  return resolveQrOrderSession(token);
}

/** Classifies a failed customer request without returning any prior order data. */
export async function classifyQrOrderRequestFailure(request: Request) {
  const cookieParts = request.headers.get("cookie")?.split(";").map(part => part.trim()) ?? [];
  const testPrefix = `${QR_DEV_TEST_COOKIE}=`;
  const testCookie = cookieParts.find(part => part.startsWith(testPrefix));
  const accessPrefix = `${QR_ORDER_ACCESS_COOKIE}=`;
  const accessCookie = cookieParts.find(part => part.startsWith(accessPrefix));
  const usingTestToken = Boolean(testCookie);
  const cookie = usingTestToken ? testCookie : accessCookie;
  let token: string | null = null;
  try {
    token = cookie ? decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)) : null;
  } catch {
    return "AUTH_REQUIRED" as const;
  }
  if (!validQrAccessToken(token) || (usingTestToken && !token.startsWith(QR_DEV_TEST_TOKEN_PREFIX))) {
    return "AUTH_REQUIRED" as const;
  }
  if (usingTestToken && !(await isDevelopmentQrTestDatabase())) return "AUTH_REQUIRED" as const;

  const testSession = usingTestToken;
  const maxAgeSeconds = testSession ? QR_DEV_TEST_MAX_AGE_SECONDS : QR_ORDER_ACCESS_MAX_AGE_SECONDS;
  const [session] = await db.select({
    qrStatus: qrSessions.status,
    sessionId: qrSessions.sessionId,
    createdAt: qrSessions.createdAt,
    tableStatus: tableSessions.status,
    sessionKind: tableSessions.sessionKind,
    expired: sql<boolean>`CASE
      WHEN ${qrSessions.sessionId} IS NULL
        THEN DATE_ADD(${qrSessions.createdAt}, INTERVAL ${maxAgeSeconds} SECOND) <= CURRENT_TIMESTAMP
      WHEN ${testSession}
        THEN DATE_ADD(${qrSessions.createdAt}, INTERVAL ${maxAgeSeconds} SECOND) <= CURRENT_TIMESTAMP
          OR ${qrTableSessionExpiresAtSql(qrSessions.sessionId)} <= CURRENT_TIMESTAMP
      ELSE ${qrTableSessionExpiresAtSql(qrSessions.sessionId)} <= CURRENT_TIMESTAMP
    END`,
  }).from(qrSessions)
    .leftJoin(tableSessions, eq(tableSessions.sessionId, qrSessions.sessionId))
    .where(eq(qrSessions.tokenHash, hashQrToken(token)))
    .limit(1);

  if (!session) return "AUTH_REQUIRED" as const;
  let hasCompletedOrder = false;
  let hasUnsettledOrder = false;
  let hasPaidAllocation = false;
  if (session.sessionId !== null && session.tableStatus === "CLOSED" && session.sessionKind === "DINE_IN") {
    const sessionOrders = await db.select({ status: orders.status }).from(orders)
      .where(eq(orders.sessionId, Number(session.sessionId)));
    hasCompletedOrder = sessionOrders.some(order => order.status === "COMPLETED");
    hasUnsettledOrder = sessionOrders.some(order => order.status !== "COMPLETED" && order.status !== "CANCELLED");
    const [paidAllocation] = hasCompletedOrder && !hasUnsettledOrder ? await db.select({ sessionId: paymentSessionAllocations.sessionId })
      .from(paymentSessionAllocations)
      .innerJoin(payments, eq(payments.paymentId, paymentSessionAllocations.paymentId))
      .innerJoin(checkouts, eq(checkouts.checkoutId, payments.checkoutId))
      .where(and(
        eq(paymentSessionAllocations.sessionId, Number(session.sessionId)),
        eq(checkouts.status, "PAID"),
        eq(payments.status, "APPROVED"),
      )).limit(1) : [];
    hasPaidAllocation = Boolean(paidAllocation);
  }
  return classifyQrOrderAccessState({
    qrStatus: session.qrStatus,
    sessionId: session.sessionId === null ? null : Number(session.sessionId),
    tableStatus: session.tableStatus,
    sessionKind: session.sessionKind,
    expired: Boolean(session.expired),
    hasCompletedOrder,
    hasUnsettledOrder,
    hasPaidAllocation,
  });
}
