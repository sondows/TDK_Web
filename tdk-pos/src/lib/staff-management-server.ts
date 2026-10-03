import "server-only";

import { randomBytes } from "crypto";
import { staff } from "@/db/schema";
import { type StaffDraft, type StaffSummary, validateStaffDraft } from "@/lib/staff-management";

export const staffColumns = {
  staffId: staff.staffId,
  staffCode: staff.staffCode,
  name: staff.name,
  role: staff.role,
  isActive: staff.isActive,
  pinHash: staff.pinHash,
  adminLoginId: staff.adminLoginId,
  adminPinHash: staff.adminPinHash,
};

export type StaffRow = {
  staffId: number; staffCode: string; name: string; role: "OWNER" | "MANAGER" | "STAFF";
  isActive: number; pinHash: string | null; adminLoginId: string | null; adminPinHash: string | null;
};

export function toStaffSummary(row: StaffRow): StaffSummary {
  return {
    staffId: row.staffId,
    name: row.staffCode === "000" ? "매장 공용" : row.name,
    role: row.role,
    isActive: row.isActive === 1,
    posEnabled: Boolean(row.pinHash),
    adminEnabled: Boolean(row.adminLoginId && row.adminPinHash),
    adminLoginId: row.adminLoginId,
    isShared: row.staffCode === "000",
  };
}

export function parseStaffDraft(input: unknown, original?: StaffSummary) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (typeof body.name !== "string" || typeof body.role !== "string" ||
      typeof body.isActive !== "boolean" || typeof body.posEnabled !== "boolean" ||
      typeof body.adminEnabled !== "boolean" || typeof body.adminLoginId !== "string" ||
      typeof body.posPin !== "string" || typeof body.posPinConfirm !== "string" ||
      typeof body.adminPin !== "string" || typeof body.adminPinConfirm !== "string") return null;
  const draft: StaffDraft = {
    name: body.name.trim(), role: body.role as StaffDraft["role"], isActive: body.isActive,
    posEnabled: body.posEnabled, posPin: body.posPin, posPinConfirm: body.posPinConfirm,
    adminEnabled: body.adminEnabled, adminLoginId: body.adminLoginId.trim().toLowerCase(),
    adminPin: body.adminPin, adminPinConfirm: body.adminPinConfirm,
  };
  const errors = validateStaffDraft(draft, original);
  return { draft, errors, valid: Object.keys(errors).length === 0 };
}

export function newInternalStaffCode() {
  return `AUTO-${randomBytes(12).toString("hex")}`;
}

export function isDuplicateAdminLoginId(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string; sqlMessage?: string }; sqlMessage?: string };
  const message = candidate.cause?.sqlMessage ?? candidate.sqlMessage ?? "";
  return (candidate.code === "ER_DUP_ENTRY" || candidate.cause?.code === "ER_DUP_ENTRY") && message.includes("uq_staff_admin_login_id");
}
