import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { canManageSettings, getPrivilegedStaff } from "@/lib/permissions";
import { getReceiptLogoFileName, receiptLogoSettingKey, removeReceiptLogo, saveReceiptLogo } from "@/lib/receipt-logo-storage";
import { getStoreInfo, storeInfoSettingKeys, type StoreInfo } from "@/lib/store-info";

export const runtime = "nodejs";

async function authorizedStaff() {
  const staff = await getPrivilegedStaff();
  if (!staff) return { error: Response.json({ success: false, message: "관리자 인증이 필요합니다." }, { status: 401 }) };
  if (!canManageSettings(staff.role) || staff.staffCode === "000")
    return { error: Response.json({ success: false, message: "OWNER만 매장정보를 변경할 수 있습니다." }, { status: 403 }) };
  return { staff };
}

export async function GET() {
  const auth = await authorizedStaff();
  if (auth.error) return auth.error;
  try {
    const [storeInfo, logoFileName] = await Promise.all([getStoreInfo(), getReceiptLogoFileName()]);
    return Response.json({ success: true, storeInfo, logoFileName });
  } catch (error) {
    console.error("store info query failed", error);
    return Response.json({ success: false, message: "매장정보를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authorizedStaff();
  if (auth.error) return auth.error;
  let stagedLogoFileName: string | null = null;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 5 * 1024 * 1024)
      return Response.json({ success: false, message: "로고 이미지는 4MB 이하여야 합니다." }, { status: 413 });
    const multipart = request.headers.get("content-type")?.includes("multipart/form-data") ?? false;
    const form = multipart ? await request.formData() : null;
    const body: unknown = form ? Object.fromEntries(form.entries()) : await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return Response.json({ success: false, message: "입력한 매장정보를 확인해 주세요." }, { status: 400 });
    const input = body as Record<string, unknown>;
    const logoAction = form?.get("logoAction") ?? "keep";
    const logoFile = form?.get("receiptLogo") ?? null;
    if (!["keep", "replace", "delete"].includes(String(logoAction)) ||
        (logoAction === "replace" && (!(logoFile instanceof File) || !logoFile.size)) ||
        (logoAction !== "replace" && logoFile !== null))
      return Response.json({ success: false, message: "영수증 로고 선택을 확인해 주세요." }, { status: 400 });
    const storeInfo = {} as StoreInfo;
    for (const field of Object.keys(storeInfoSettingKeys) as (keyof StoreInfo)[]) {
      const value = input[field];
      if (typeof value !== "string" || !value.trim() || value.trim().length > 255)
        return Response.json({ success: false, message: "모든 항목을 입력하고 각 항목을 255자 이내로 작성해 주세요." }, { status: 400 });
      storeInfo[field] = value.trim();
    }

    if (logoAction === "replace") stagedLogoFileName = await saveReceiptLogo(logoFile as File);
    const oldLogoFileName = await getReceiptLogoFileName();
    const savedLogoFileName = logoAction === "keep" ? oldLogoFileName : logoAction === "replace" ? stagedLogoFileName : null;
    await db.transaction(async (tx) => {
      for (const field of Object.keys(storeInfoSettingKeys) as (keyof StoreInfo)[]) {
        const value = storeInfo[field];
        await tx.insert(systemSettings).values({
          settingKey: storeInfoSettingKeys[field],
          settingValue: value,
          updatedByStaffId: auth.staff!.staffId,
        }).onDuplicateKeyUpdate({
          set: { settingValue: value, updatedByStaffId: auth.staff!.staffId, updatedAt: new Date() },
        });
      }
      if (logoAction !== "keep") {
        const fileName = logoAction === "replace" ? stagedLogoFileName! : "";
        await tx.insert(systemSettings).values({
          settingKey: receiptLogoSettingKey,
          settingValue: fileName,
          updatedByStaffId: auth.staff!.staffId,
        }).onDuplicateKeyUpdate({
          set: { settingValue: fileName, updatedByStaffId: auth.staff!.staffId, updatedAt: new Date() },
        });
      }
    });
    stagedLogoFileName = null;
    if (logoAction !== "keep" && oldLogoFileName)
      await removeReceiptLogo(oldLogoFileName).catch(error => console.error("old receipt logo cleanup failed", error));
    return Response.json({ success: true, storeInfo, logoFileName: savedLogoFileName });
  } catch (error) {
    if (stagedLogoFileName) await removeReceiptLogo(stagedLogoFileName).catch(() => {});
    console.error("store info save failed", error);
    if (error instanceof Error && (/^로고 이미지는|^PNG 또는 JPG/.test(error.message)))
      return Response.json({ success: false, message: error.message }, { status: 400 });
    return Response.json({ success: false, message: "매장정보 저장에 실패했습니다. 다시 시도해 주세요." }, { status: 500 });
  }
}
