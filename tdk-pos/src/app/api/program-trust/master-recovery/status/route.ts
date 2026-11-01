import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { adminSecurityOwners, masterPasswordRecoveryGrants, staff } from "@/db/schema";
import { reserveAdminStatusAttempt } from "@/lib/admin-auth-limit";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { masterRecoveryCookieName, masterRecoveryCookieOptions } from "@/lib/master-recovery-cookie";
import { isSecureTrustRequest } from "@/lib/program-trust";

const noStore = { "Cache-Control": "no-store" };

/** The NAS grant, not an ID lookup, authorizes disclosure of registration state. */
export async function POST(request: Request) {
  if (!isHttpsSameOriginRequest(request) || !isSecureTrustRequest(request))
    return Response.json({ available: false }, { status: 403, headers: noStore });
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
    const submittedToken = typeof body?.token === "string" ? body.token : "";
    const token = submittedToken || (await cookies()).get(masterRecoveryCookieName)?.value || "";
    let grant: { grantId: number; remainingSeconds: number; passwordHash: string | null;
      loginId: string | null } | undefined;
    // A valid one-use bearer grant is the authority to reveal this account's setup state.
    // loginId is optional so a page refresh can restore the flow from the HttpOnly cookie.
    if ((!loginId || /^[a-z][a-z0-9._-]{2,31}$/.test(loginId)) &&
      /^[A-Za-z0-9_-]{43}$/.test(token)) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      [grant] = await db.select({ grantId: masterPasswordRecoveryGrants.grantId,
        remainingSeconds: sql<number>`TIMESTAMPDIFF(SECOND, NOW(), ${masterPasswordRecoveryGrants.expiresAt})`,
        passwordHash: staff.securityPasswordHash,
        loginId: staff.adminLoginId })
        .from(masterPasswordRecoveryGrants)
        .innerJoin(staff, eq(staff.staffId, masterPasswordRecoveryGrants.staffId))
        .innerJoin(adminSecurityOwners, eq(adminSecurityOwners.staffId, staff.staffId))
        .where(and(eq(masterPasswordRecoveryGrants.tokenHash, tokenHash),
          isNull(masterPasswordRecoveryGrants.usedAt), isNull(masterPasswordRecoveryGrants.revokedAt),
          sql`${masterPasswordRecoveryGrants.expiresAt} > NOW()`,
          ...(loginId ? [sql`LOWER(${staff.adminLoginId}) = ${loginId}`] : []),
          eq(staff.isActive, 1), eq(staff.adminEnabled, 1), isNull(staff.terminatedAt)))
        .limit(1);
    }
    if (!grant) {
      const ipLimit = await reserveAdminStatusAttempt("master-recovery-status", await getKdsRateLimitIp());
      if (ipLimit === null) return Response.json({ available: false,
        message: "네트워크 주소를 확인할 수 없어 상태 조회를 진행할 수 없습니다." }, { status: 503, headers: noStore });
      if (!ipLimit) return Response.json({ available: false }, { status: 429, headers: noStore });
    }
    const response = NextResponse.json({ available: Boolean(grant),
      ...(grant ? { loginId: grant.loginId,
        passwordConfigured: Boolean(grant.passwordHash),
        registrationKind: grant.passwordHash ? "reset" : "first" } : {}) }, { headers: noStore });
    if (grant && submittedToken) response.cookies.set(masterRecoveryCookieName, token, {
      ...masterRecoveryCookieOptions,
      maxAge: Math.min(masterRecoveryCookieOptions.maxAge,
        Math.max(1, Math.floor(Number(grant.remainingSeconds)))),
    });
    return response;
  } catch (error) {
    console.error("Master recovery status unavailable", { code: (error as { code?: string }).code });
    return Response.json({ available: false }, { status: 503, headers: noStore });
  }
}
