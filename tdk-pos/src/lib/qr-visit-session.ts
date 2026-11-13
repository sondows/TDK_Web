import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { qrVisitSessions } from "@/db/schema";

export const QR_VISIT_COOKIE = "tdkon_qr_visit";

export function readRequestCookie(request: Request, name: string) {
  const prefix = `${name}=`;
  const entry = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

export function isSameOriginQrRequest(request: Request) {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return true;
  let origin: URL;
  try { origin = new URL(originHeader); } catch { return false; }
  const expectedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() || request.headers.get("host");
  return Boolean(expectedHost && origin.host.toLowerCase() === expectedHost.toLowerCase());
}

export function qrCookieAttributes(request: Request, maxAgeSeconds: number, path: string) {
  const secure = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https" || new URL(request.url).protocol === "https:";
  return `Path=${path}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export async function resolveQrVisitor(tx: Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0], request: Request, now: Date, ttlMs: number) {
  const submitted = readRequestCookie(request, QR_VISIT_COOKIE);
  let token = submitted && /^[A-Za-z0-9_-]{40,64}$/.test(submitted) ? submitted : null;
  let tokenHash = token ? createHash("sha256").update(token).digest("hex") : "";
  if (token) {
    const [existing] = await tx.select({ visitorId: qrVisitSessions.visitorId }).from(qrVisitSessions)
      .where(and(eq(qrVisitSessions.tokenHash, tokenHash), isNull(qrVisitSessions.revokedAt), gt(qrVisitSessions.expiresAt, now)))
      .for("update").limit(1);
    if (existing) {
      const expiresAt = new Date(now.getTime() + ttlMs);
      await tx.update(qrVisitSessions).set({ lastSeenAt: now, expiresAt }).where(eq(qrVisitSessions.visitorId, existing.visitorId));
      return { visitorId: existing.visitorId, token, expiresAt };
    }
  }
  token = randomBytes(32).toString("base64url");
  tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(now.getTime() + ttlMs);
  const [created] = await tx.insert(qrVisitSessions).values({ tokenHash, createdAt: now, lastSeenAt: now, expiresAt });
  return { visitorId: Number(created.insertId), token, expiresAt };
}
