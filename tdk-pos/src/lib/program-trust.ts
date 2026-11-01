import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { programTrustTokens, staff } from "@/db/schema";

export type Program = "POS" | "ADM" | "KDS" | "HOS";
export const programCookieName: Record<Program, string> = {
  POS: "tdk_pos_trust", ADM: "tdk_adm_trust", KDS: "tdk_kds_trust", HOS: "tdk_hos_trust",
};
export const tokenCookieName = (program: Program, tokenId: number) => `${programCookieName[program]}_${tokenId}`;
export const trustCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  // Browsers cap persistent cookies; renew this while the server-side token remains valid.
  maxAge: 400 * 24 * 60 * 60,
};

export const newProgramTrustToken = () => randomBytes(32).toString("base64url");
export const hashProgramTrustToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function isProgram(value: unknown): value is Program {
  return value === "POS" || value === "ADM" || value === "KDS" || value === "HOS";
}

export function programPermission(program: Program) {
  return program === "POS" ? staff.posEnabled : program === "ADM" ? staff.adminEnabled
    : program === "KDS" ? staff.kdsEnabled : staff.hosEnabled;
}

/** Set only by the ingress after it has authenticated the Caddy hop. */
export function isSecureTrustRequest(request: Request) {
  if (request.headers.get("x-tdk-verified-https") === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return request.headers.get("x-tdk-local-dev") === "1" &&
    /^(localhost|127\.0\.0\.1):\d+$/.test(request.headers.get("host") ?? "");
}

/** A browser may hold separate tokens for several employees using the same program. */
export async function getCurrentProgramTrust(program: Program, selector?: { loginId?: string; tokenId?: number }) {
  const cookieStore = await cookies();
  const prefix = `${programCookieName[program]}_`;
  const candidates = cookieStore.getAll().filter(item =>
    (item.name === programCookieName[program] || (item.name.startsWith(prefix) &&
      /^\d+$/.test(item.name.slice(prefix.length)))) &&
    item.value.length >= 20 && item.value.length <= 128 &&
    (!selector?.tokenId || item.name === tokenCookieName(program, selector.tokenId) ||
      item.name === programCookieName[program])).slice(0, 40);
  if (!candidates.length) return null;
  const hashes = candidates.map(item => hashProgramTrustToken(item.value));
  const records = await db.select({
    tokenId: programTrustTokens.tokenId,
    enrolledByStaffId: programTrustTokens.enrolledByStaffId,
    tokenHash: programTrustTokens.tokenHash,
  }).from(programTrustTokens)
    .innerJoin(staff, eq(staff.staffId, programTrustTokens.enrolledByStaffId))
    .where(and(inArray(programTrustTokens.tokenHash, hashes),
      eq(programTrustTokens.program, program), isNull(programTrustTokens.revokedAt),
      eq(staff.isActive, 1), isNull(staff.terminatedAt),
      eq(programPermission(program), 1), ne(staff.staffCode, "000"),
      ...(selector?.loginId ? [sql`LOWER(${staff.adminLoginId}) = ${selector.loginId.trim().toLowerCase()}`] : []),
      ...(selector?.tokenId ? [eq(programTrustTokens.tokenId, selector.tokenId)] : [])))
    .orderBy(desc(programTrustTokens.tokenId)).limit(40);
  for (const record of records) {
    const matchingCookie = candidates.find(item => hashProgramTrustToken(item.value) === record.tokenHash &&
      (item.name === programCookieName[program] || item.name === tokenCookieName(program, record.tokenId)));
    if (matchingCookie) return { tokenId: record.tokenId, enrolledByStaffId: record.enrolledByStaffId,
      cookieName: matchingCookie.name };
  }
  return null;
}
