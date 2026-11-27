import { createHash } from "node:crypto";

export const QR_ORDER_AUTH_ATTEMPT_TTL_MS = 2 * 60 * 1000;
export const QR_ORDER_AUTH_RATE_WINDOW_MS = 10 * 60 * 1000;
export const QR_ORDER_AUTH_MAX_FAILURES = 3;
export const QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_SESSION = 5;
export const QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_TABLE = 20;

export function isQrOrderAuthFlowEnabled(nodeEnv: string | undefined, databaseName: string | undefined, flag: string | undefined) {
  return flag === "true" && ((nodeEnv === "development" && databaseName === "TDK_POS_TEST") ||
    (nodeEnv === "production" && databaseName === "TDK_POS"));
}

export type QrOrderAuthCartLine = {
  menuId: number;
  qty: number;
  options?: Array<{ modifierOptionId: number; qty: number }>;
};

export function validQrOrderAuthCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}$/.test(value);
}

/** Stable digest used to make one client request ID inseparable from its cart. */
export function qrOrderAuthCartFingerprint(lines: QrOrderAuthCartLine[]): string {
  const canonical = lines.map(line => ({
    menuId: line.menuId,
    qty: line.qty,
    options: [...(line.options ?? [])]
      .map(option => ({ modifierOptionId: option.modifierOptionId, qty: option.qty }))
      .sort((a, b) => a.modifierOptionId - b.modifierOptionId || a.qty - b.qty),
  })).sort((a, b) => a.menuId - b.menuId || a.qty - b.qty || JSON.stringify(a.options).localeCompare(JSON.stringify(b.options)));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function canStartQrOrderAuthAttempt(counts: { session: number; table: number }): boolean {
  return Number.isInteger(counts.session) && Number.isInteger(counts.table) &&
    counts.session >= 0 && counts.table >= 0 &&
    counts.session < QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_SESSION &&
    counts.table < QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_TABLE;
}

export function nextQrOrderAuthFailure(failedAttempts: number) {
  const nextFailedAttempts = Math.min(QR_ORDER_AUTH_MAX_FAILURES, Math.max(0, Math.trunc(failedAttempts)) + 1);
  return { failedAttempts: nextFailedAttempts, blocked: nextFailedAttempts >= QR_ORDER_AUTH_MAX_FAILURES };
}

export function classifyQrOrderAuthAttempt(state: string, expiresAtMs: number, nowMs: number) {
  if (state === "PENDING" && expiresAtMs <= nowMs) return "EXPIRED" as const;
  if (state === "PENDING" || state === "VERIFIED" || state === "CONSUMED" || state === "BLOCKED" || state === "EXPIRED") return state;
  return "INVALID" as const;
}
