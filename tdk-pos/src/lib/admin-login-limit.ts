import "server-only";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; expiresAt: number }>();

/** Reserves a server-side attempt before PIN verification, including parallel requests. */
export function reserveAdminLoginAttempt(loginId: string) {
  const now = Date.now();
  const current = attempts.get(loginId);
  const next = !current || current.expiresAt <= now
    ? { count: 1, expiresAt: now + WINDOW_MS }
    : { count: current.count + 1, expiresAt: current.expiresAt };
  attempts.set(loginId, next);
  if (attempts.size > 10000) {
    for (const [key, value] of attempts) if (value.expiresAt <= now) attempts.delete(key);
  }
  return next.count <= MAX_ATTEMPTS;
}

export function clearAdminLoginAttempts(loginId: string) {
  attempts.delete(loginId);
}
