import { asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { discountRules } from "@/db/schema";
import { canManageSettings } from "@/lib/permissions";
import { getManagementOwner } from "@/lib/management-auth";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

type PresetInput = { slot?: unknown; title?: unknown; type?: unknown; value?: unknown; isActive?: unknown };

const toWholeNumber = (value: unknown) => Number.isSafeInteger(Number(value)) ? Number(value) : NaN;

async function requireOwner() {
  const staff = await getManagementOwner();
  return staff && canManageSettings(staff.role) ? staff : null;
}

export async function GET() {
  const currentStaff = await getCurrentStaff();
  const adminStaff = await getCurrentAdminStaff();
  if (!currentStaff && !adminStaff && await getPosLoginMode() !== "SHARED") return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const rules = await db.select({ ruleId: discountRules.discountRuleId, slot: discountRules.posPresetSlot, title: discountRules.discountName, type: discountRules.discountType, value: discountRules.discountValue, isActive: discountRules.isActive })
    .from(discountRules).where(isNotNull(discountRules.posPresetSlot)).orderBy(asc(discountRules.posPresetSlot));
  return Response.json({ success: true, presets: rules });
}

export async function PUT(request: Request) {
  if (!await requireOwner()) return Response.json({ success: false, message: "할인 설정 권한이 필요합니다." }, { status: 403 });
  let body: { presets?: PresetInput[] };
  try { body = await request.json() as { presets?: PresetInput[] }; } catch { return Response.json({ success: false, message: "할인 설정 요청을 확인하세요." }, { status: 400 }); }
  if (!Array.isArray(body.presets) || body.presets.length !== 4) return Response.json({ success: false, message: "지정 할인 4개 슬롯을 모두 전달하세요." }, { status: 400 });

  const bySlot = new Map<number, { title: string; type: "AMOUNT" | "RATE"; value: number; isActive: boolean }>();
  for (const preset of body.presets) {
    const slot = toWholeNumber(preset.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > 4 || bySlot.has(slot)) return Response.json({ success: false, message: "할인 슬롯을 확인하세요." }, { status: 400 });
    const isActive = preset.isActive === true;
    const title = typeof preset.title === "string" ? preset.title.trim() : "";
    const type = preset.type === "AMOUNT" ? "AMOUNT" : preset.type === "PERCENT" ? "RATE" : null;
    const value = toWholeNumber(preset.value);
    if (isActive && (!title || title.length > 150 || !type || !Number.isInteger(value) || value <= 0 || (type === "RATE" && value > 100))) return Response.json({ success: false, message: "활성 지정 할인 항목을 확인하세요." }, { status: 400 });
    bySlot.set(slot, { title, type: type ?? "AMOUNT", value: Number.isInteger(value) && value > 0 ? value : 0, isActive });
  }

  const saved = await db.transaction(async (tx) => {
    const existing = await tx.select({ ruleId: discountRules.discountRuleId, slot: discountRules.posPresetSlot }).from(discountRules).where(isNotNull(discountRules.posPresetSlot));
    const existingBySlot = new Map(existing.flatMap(rule => rule.slot === null ? [] : [[rule.slot, rule.ruleId] as const]));
    for (const slot of [1, 2, 3, 4]) {
      const preset = bySlot.get(slot)!;
      const ruleId = existingBySlot.get(slot);
      if (!preset.isActive) {
        if (ruleId) await tx.delete(discountRules).where(eq(discountRules.discountRuleId, ruleId));
        continue;
      }
      const values = { discountCode: `POS_PRESET_${slot}`, discountName: preset.title, discountType: preset.type, discountValue: preset.value.toFixed(2), maxDiscountAmount: null, minOrderAmount: "0.00", requiresManager: 0, startAt: null, endAt: null, isActive: 1, posPresetSlot: slot } as const;
      if (ruleId) await tx.update(discountRules).set(values).where(eq(discountRules.discountRuleId, ruleId));
      else await tx.insert(discountRules).values(values);
    }
    return tx.select({ ruleId: discountRules.discountRuleId, slot: discountRules.posPresetSlot, title: discountRules.discountName, type: discountRules.discountType, value: discountRules.discountValue, isActive: discountRules.isActive }).from(discountRules).where(inArray(discountRules.posPresetSlot, [1, 2, 3, 4])).orderBy(asc(discountRules.posPresetSlot));
  });
  return Response.json({ success: true, presets: saved });
}
