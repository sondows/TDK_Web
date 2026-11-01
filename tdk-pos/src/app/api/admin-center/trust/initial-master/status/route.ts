import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { adminSecurityOwners, staff } from "@/db/schema";
import { reserveAdminStatusAttempt } from "@/lib/admin-auth-limit";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { reserveKdsIpAttempt } from "@/lib/kds-device";
import { isNasOwnerSetupWrite } from "@/lib/nas-owner-setup";
import { classifyInitialMasterAccount } from "@/lib/initial-admin-setup";
import { requiresInitialMasterStatusLimit } from "@/lib/owner-setup-mode.cjs";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";

const noStore = { "Cache-Control": "no-store" };

/** Status is visible only in explicitly attested setup mode; ID alone never authorizes registration. */
export async function POST(request: Request) {
  const setupWrite = isNasOwnerSetupWrite(request);
  if (!setupWrite) {
    if (!isHttpsSameOriginRequest(request))
      return NextResponse.json({ available: false }, { status: 403, headers: noStore });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId))
    return NextResponse.json({ available: false }, { headers: noStore });
  try {
    if (new URL(request.url).searchParams.get("program") === "KDS") {
      const ipLimit = await reserveKdsIpAttempt("initial-master-status");
      if (ipLimit === "ip-unavailable") return NextResponse.json({ available: false,
        code: "KDS_RATE_LIMIT_IP_UNAVAILABLE", message: "KDS 로그인 네트워크를 확인할 수 없습니다. 연결 설정을 확인해 주세요." },
      { status: 503, headers: noStore });
      if (ipLimit !== "allowed") return NextResponse.json({ available: false,
        code: ipLimit === "network-limited" ? "KDS_NETWORK_RATE_LIMIT" : "KDS_INITIAL_STATUS_RATE_LIMIT",
        message: ipLimit === "network-limited" ? "이 네트워크에서 KDS 로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요."
          : "KDS 초기 설정 상태조회 요청이 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: noStore });
    } else if (requiresInitialMasterStatusLimit(process.env)) {
      const ipLimit = await reserveAdminStatusAttempt("initial-master-status", await getKdsRateLimitIp());
      if (ipLimit === null) return NextResponse.json({ available: false,
        code: "CLIENT_IP_UNAVAILABLE", message: "네트워크 주소를 확인할 수 없어 상태 조회를 진행할 수 없습니다." },
      { status: 503, headers: noStore });
      if (!ipLimit) return NextResponse.json({ available: false }, { status: 429, headers: noStore });
    }
    const [account] = await db.select({ staffId: staff.staffId, passwordHash: staff.securityPasswordHash,
      role: staff.role, isActive: staff.isActive, adminEnabled: staff.adminEnabled,
      terminatedAt: staff.terminatedAt, staffCode: staff.staffCode,
      resetRequired: staff.securityPasswordChangeRequired,
      isOwner: sql<boolean>`${adminSecurityOwners.staffId} IS NOT NULL`.as("is_owner") }).from(staff)
      .leftJoin(adminSecurityOwners, eq(adminSecurityOwners.staffId, staff.staffId))
      .where(sql`LOWER(${staff.adminLoginId}) = ${loginId}`)
      .limit(1);
    const resetPasswordRequired = Boolean(account && account.isActive === 1 && !account.terminatedAt &&
      account.staffCode !== "000" && account.adminEnabled === 1 && account.resetRequired === 1 &&
      account.passwordHash === null);
    if (resetPasswordRequired) return NextResponse.json({ resetPasswordRequired: true }, { headers: noStore });
    if (!setupWrite) return NextResponse.json({ resetPasswordRequired: false }, { headers: noStore });
    const state = classifyInitialMasterAccount({ accountFound: Boolean(account),
      passwordHash: account?.passwordHash ?? null, role: account?.role,
      active: account?.isActive, adminEnabled: account?.adminEnabled,
      terminatedAt: account?.terminatedAt, staffCode: account?.staffCode,
      isOwner: Boolean(account?.isOwner) });
    return NextResponse.json({ state, available: state === "MASTER_PASSWORD_REQUIRED",
      accountFound: Boolean(account), passwordConfigured: account ? account.passwordHash !== null : null }, { headers: noStore });
  } catch (error) {
    console.error("Initial master status unavailable", { code: (error as { code?: string }).code });
    return NextResponse.json({ available: false }, { status: 503, headers: noStore });
  }
}
