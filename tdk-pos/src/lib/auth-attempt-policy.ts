import { createHash } from "node:crypto";

export const AUTH_FAILURE_LIMIT = 30;
export const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;

export type AttemptCounter = { attemptCount: number; windowStartedAt: Date | number };

export function normalizeAttemptAccount(account: string) {
  return account.trim().toLowerCase();
}

export function authAttemptKey(scope: string, kind: "account" | "ip", value: string) {
  const normalized = kind === "account" ? normalizeAttemptAccount(value) : value.trim();
  return createHash("sha256").update(`${scope}:${kind}:${normalized}`).digest("hex");
}

export function canAttempt(counter: AttemptCounter | undefined, nowMs: number, limit = AUTH_FAILURE_LIMIT) {
  return !counter || new Date(counter.windowStartedAt).getTime() <= nowMs - AUTH_FAILURE_WINDOW_MS ||
    counter.attemptCount < limit;
}

/** Sliding fixed window: the threshold-th failed credential is recorded; the next is rejected. */
export function nextFailedAttempt(counter: AttemptCounter | undefined, nowMs: number, limit = AUTH_FAILURE_LIMIT) {
  if (!counter || new Date(counter.windowStartedAt).getTime() <= nowMs - AUTH_FAILURE_WINDOW_MS)
    return { attemptCount: 1, windowStartedAt: new Date(nowMs), allowed: true };
  if (counter.attemptCount >= limit) return {
    attemptCount: counter.attemptCount,
    windowStartedAt: new Date(counter.windowStartedAt),
    allowed: false,
  };
  const attemptCount = counter.attemptCount + 1;
  return { attemptCount, windowStartedAt: new Date(counter.windowStartedAt), allowed: attemptCount <= limit };
}
