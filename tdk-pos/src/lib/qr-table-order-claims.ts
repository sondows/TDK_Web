import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { qrOrderAuthAttempts, qrOrders, qrSessions, qrTableOrderClaims, tableSessions } from "@/db/schema";
import { classifyQrRepresentativePermission, sameQrClaimIdentity, type QrRepresentativePermission } from "@/lib/qr-table-order-claim-policy";
import { hasQrOrderAuthSchema } from "@/lib/qr-order-auth";

type Tx = Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0];
export type QrOrderClaim = typeof qrTableOrderClaims.$inferSelect;
export type QrOrderClaimIdentity = {
  tableId: number;
  representativeQrSessionId: number;
  firstQrOrderId: number;
};

/** Callers acquire the dining_tables row lock before calling these helpers. */
export async function getQrTableOrderClaim(tx: Tx, tableId: number): Promise<QrOrderClaim | null> {
  const [claim] = await tx.select().from(qrTableOrderClaims).where(eq(qrTableOrderClaims.tableId, tableId)).for("update").limit(1);
  return claim ?? null;
}

const sameIdentity = sameQrClaimIdentity;

function isDuplicateKey(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.cause?.code === "ER_DUP_ENTRY";
}

export async function createQrTableOrderClaim(tx: Tx, identity: QrOrderClaimIdentity, tableSessionId: number | null = null) {
  const existing = await getQrTableOrderClaim(tx, identity.tableId);
  if (existing) return sameIdentity(existing, identity) ? "EXISTING" as const : "CONFLICT" as const;
  const [customer] = await tx.select({ tableId: qrSessions.tableId, status: qrSessions.status }).from(qrSessions)
    .where(eq(qrSessions.qrSessionId, identity.representativeQrSessionId)).limit(1);
  const [firstOrder] = await tx.select({ qrSessionId: qrOrders.qrSessionId, status: qrOrders.status }).from(qrOrders)
    .where(eq(qrOrders.qrOrderId, identity.firstQrOrderId)).limit(1);
  if (!customer || Number(customer.tableId) !== identity.tableId || customer.status !== "ACTIVE" ||
    !firstOrder || Number(firstOrder.qrSessionId) !== identity.representativeQrSessionId || firstOrder.status !== "PENDING")
    return "INVALID" as const;
  if (tableSessionId !== null) {
    const [visit] = await tx.select({ tableId: tableSessions.tableId, status: tableSessions.status, kind: tableSessions.sessionKind })
      .from(tableSessions).where(eq(tableSessions.sessionId, tableSessionId)).limit(1);
    if (!visit || Number(visit.tableId) !== identity.tableId || visit.status !== "OPEN" || visit.kind !== "DINE_IN") return "INVALID" as const;
  }
  try {
    await tx.insert(qrTableOrderClaims).values({ ...identity, tableSessionId, state: "PENDING" });
    return "CREATED" as const;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const winner = await getQrTableOrderClaim(tx, identity.tableId);
    return winner && sameIdentity(winner, identity) ? "EXISTING" as const : "CONFLICT" as const;
  }
}

export async function confirmQrTableOrderClaim(tx: Tx, identity: QrOrderClaimIdentity, tableSessionId: number) {
  const [firstOrder] = await tx.select({ qrSessionId: qrOrders.qrSessionId, status: qrOrders.status, acceptedOrderId: qrOrders.acceptedOrderId })
    .from(qrOrders).where(eq(qrOrders.qrOrderId, identity.firstQrOrderId)).limit(1);
  const [visit] = await tx.select({ tableId: tableSessions.tableId, status: tableSessions.status, kind: tableSessions.sessionKind })
    .from(tableSessions).where(eq(tableSessions.sessionId, tableSessionId)).limit(1);
  if (!firstOrder || Number(firstOrder.qrSessionId) !== identity.representativeQrSessionId || firstOrder.status !== "ACCEPTED" ||
    firstOrder.acceptedOrderId === null || !visit || Number(visit.tableId) !== identity.tableId || visit.status !== "OPEN" || visit.kind !== "DINE_IN")
    return "INVALID" as const;
  const [result] = await tx.update(qrTableOrderClaims).set({ state: "CONFIRMED", tableSessionId, confirmedAt: new Date() })
    .where(and(eq(qrTableOrderClaims.tableId, identity.tableId),
      eq(qrTableOrderClaims.representativeQrSessionId, identity.representativeQrSessionId),
      eq(qrTableOrderClaims.firstQrOrderId, identity.firstQrOrderId), eq(qrTableOrderClaims.state, "PENDING")));
  if (result.affectedRows === 1) return "CONFIRMED" as const;
  const current = await getQrTableOrderClaim(tx, identity.tableId);
  return current && sameIdentity(current, identity) && current.state === "CONFIRMED" &&
    Number(current.tableSessionId) === tableSessionId ? "EXISTING" as const : "CONFLICT" as const;
}

export async function releasePendingQrTableOrderClaim(tx: Tx, identity: QrOrderClaimIdentity) {
  const [firstOrder] = await tx.select({ status: qrOrders.status }).from(qrOrders).where(eq(qrOrders.qrOrderId, identity.firstQrOrderId)).limit(1);
  if (!firstOrder || !["REJECTED", "CANCELLED"].includes(firstOrder.status)) return false;
  const [result] = await tx.delete(qrTableOrderClaims).where(and(eq(qrTableOrderClaims.tableId, identity.tableId),
    eq(qrTableOrderClaims.representativeQrSessionId, identity.representativeQrSessionId),
    eq(qrTableOrderClaims.firstQrOrderId, identity.firstQrOrderId), eq(qrTableOrderClaims.state, "PENDING")));
  return result.affectedRows === 1;
}

export async function releaseCompletedQrTableOrderClaim(tx: Tx, tableId: number, tableSessionId: number) {
  const [visit] = await tx.select({ tableId: tableSessions.tableId, status: tableSessions.status }).from(tableSessions)
    .where(eq(tableSessions.sessionId, tableSessionId)).limit(1);
  if (!visit || Number(visit.tableId) !== tableId || visit.status !== "CLOSED") return false;
  const [result] = await tx.delete(qrTableOrderClaims).where(and(eq(qrTableOrderClaims.tableId, tableId),
    eq(qrTableOrderClaims.tableSessionId, tableSessionId), eq(qrTableOrderClaims.state, "CONFIRMED")));
  return result.affectedRows === 1;
}

/** Called inside the same transaction that closes the table sessions and customer QR sessions. */
export async function finishQrOrderAuthorizationForClosedVisits(
  tx: Tx, sessionIds: number[], tableIds: number[], qrSessionIds: number[],
) {
  if (!sessionIds.length || !tableIds.length) return;
  // A claim created before the flag was disabled still belongs to this visit.
  // On older installations without the TV-7 schema, preserve the legacy close path.
  if (!await hasQrOrderAuthSchema()) {
    if (process.env.TDK_QR_ORDER_AUTH_ENABLED === "true") throw new Error("QR order authorization schema is unavailable");
    return;
  }

  const attemptScope = or(inArray(qrOrderAuthAttempts.tableSessionIdAtAuth, sessionIds),
    ...(qrSessionIds.length ? [inArray(qrOrderAuthAttempts.qrSessionId, qrSessionIds)] : []));
  await tx.update(qrOrderAuthAttempts).set({ state: "BLOCKED" }).where(and(
    inArray(qrOrderAuthAttempts.tableId, tableIds), inArray(qrOrderAuthAttempts.state, ["PENDING", "VERIFIED"]), attemptScope,
  ));
  await tx.delete(qrTableOrderClaims).where(and(inArray(qrTableOrderClaims.tableId, tableIds),
    or(inArray(qrTableOrderClaims.tableSessionId, sessionIds), isNull(qrTableOrderClaims.tableSessionId))));
}

export async function getQrRepresentativePermission(tx: Tx, tableId: number, qrSessionId: number): Promise<QrRepresentativePermission> {
  const claim = await getQrTableOrderClaim(tx, tableId);
  return classifyQrRepresentativePermission(claim, qrSessionId);
}
