import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { kdsAccounts, kdsSessions } from "@/db/schema";
import { hashKdsPin, isValidKdsPin } from "@/lib/auth";
import { getCurrentAdminStaff, requireAdminWrite } from "@/lib/admin-auth";
import { isValidKdsLoginId, normalizeKdsLoginId } from "@/lib/kds-auth";

const noStore = { "Cache-Control": "no-store" };
function isDuplicateKey(error: unknown) {
  const candidate = error && typeof error === "object" && "cause" in error ? error.cause : error;
  return candidate && typeof candidate === "object" && "code" in candidate && candidate.code === "ER_DUP_ENTRY";
}

export async function GET() {
  if (!(await getCurrentAdminStaff())) return Response.json({ success: false }, { status: 401 });
  const accounts = await db.select({
    id: kdsAccounts.kdsAccountId,
    loginId: kdsAccounts.loginId,
    isActive: kdsAccounts.isActive,
  }).from(kdsAccounts).orderBy(asc(kdsAccounts.loginId));
  return Response.json({ success: true, accounts }, { headers: noStore });
}

export async function POST(request: Request) {
  const denied = await requireAdminWrite(); if (denied) return denied;
  const body = await request.json().catch(() => null) as { loginId?: unknown; pin?: unknown } | null;
  const loginId = normalizeKdsLoginId(body?.loginId);
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!isValidKdsLoginId(loginId) || !isValidKdsPin(pin)) {
    return Response.json({ success: false, message: "ID는 영문 소문자로 시작하는 3~32자, 번호는 숫자 6자리로 입력해 주세요." }, { status: 400 });
  }
  try {
    await db.insert(kdsAccounts).values({ loginId, pinHash: await hashKdsPin(pin) });
    return Response.json({ success: true }, { headers: noStore });
  } catch (error) {
    if (isDuplicateKey(error)) {
      return Response.json({ success: false, message: "이미 사용 중인 ID입니다." }, { status: 409 });
    }
    console.error("KDS account creation failed", error);
    return Response.json({ success: false, message: "KDS 계정을 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const denied = await requireAdminWrite(); if (denied) return denied;
  const body = await request.json().catch(() => null) as { id?: unknown; pin?: unknown; isActive?: unknown } | null;
  const id = body?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ success: false, message: "KDS 계정을 확인해 주세요." }, { status: 400 });
  }
  const changingPin = typeof body?.pin === "string";
  const changingActive = typeof body?.isActive === "boolean";
  if ((!changingPin && !changingActive) || (changingPin && !isValidKdsPin(body.pin as string))) {
    return Response.json({ success: false, message: "새 번호는 숫자 6자리로 입력해 주세요." }, { status: 400 });
  }
  try {
    const [account] = await db.select({ id: kdsAccounts.kdsAccountId }).from(kdsAccounts).where(eq(kdsAccounts.kdsAccountId, id)).limit(1);
    if (!account) return Response.json({ success: false, message: "KDS 계정을 찾을 수 없습니다." }, { status: 404 });
    await db.transaction(async tx => {
      await tx.update(kdsAccounts).set({
        ...(changingPin ? { pinHash: await hashKdsPin(body.pin as string) } : {}),
        ...(changingActive ? { isActive: body.isActive ? 1 : 0 } : {}),
        updatedAt: new Date(),
      }).where(eq(kdsAccounts.kdsAccountId, id));
      // Credential changes revoke existing tablet sessions immediately.
      await tx.update(kdsSessions).set({ status: "LOGGED_OUT" }).where(eq(kdsSessions.kdsAccountId, id));
    });
    return Response.json({ success: true }, { headers: noStore });
  } catch (error) {
    console.error("KDS account update failed", error);
    return Response.json({ success: false, message: "KDS 계정을 변경하지 못했습니다." }, { status: 500 });
  }
}
