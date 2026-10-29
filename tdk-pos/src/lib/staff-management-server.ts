import "server-only";
import { randomBytes } from "crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/db";
import { staff } from "@/db/schema";
import { type StaffDraft, type StaffSummary, validateStaffDraft } from "@/lib/staff-management";

export const staffColumns = {
  staffId: staff.staffId, staffCode: staff.staffCode, name: staff.name, role: staff.role,
  isActive: staff.isActive, posEnabled: staff.posEnabled, hosEnabled: staff.hosEnabled, employeePinHash: staff.employeePinHash,
  pinHash: staff.pinHash, kdsEnabled: staff.kdsEnabled, kdsPinHash: staff.kdsPinHash,
  kdsPasswordHash: staff.kdsPasswordHash, kdsTotpSecretEnc: staff.kdsTotpSecretEnc,
  kdsPinChangeRequired: staff.kdsPinChangeRequired, adminLoginId: staff.adminLoginId,
  adminPinHash: staff.adminPinHash, adminEnabled: staff.adminEnabled,
};
export const staffColumnsWithoutHos = Object.fromEntries(
  Object.entries(staffColumns).filter(([column]) => column !== "hosEnabled"),
) as Omit<typeof staffColumns, "hosEnabled">;

let hosStaffPermissionColumn: Promise<boolean> | undefined;
export function hasHosStaffPermissionColumn() {
  hosStaffPermissionColumn ??= pool.query<(RowDataPacket & { columnCount: number })[]>(
    "SELECT COUNT(*) AS columnCount FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff' AND COLUMN_NAME = 'hos_enabled'",
  ).then(([rows]) => Number(rows[0]?.columnCount ?? 0) > 0);
  return hosStaffPermissionColumn;
}

export type StaffRow = {
  staffId: number; staffCode: string; name: string; role: "OWNER" | "MANAGER" | "STAFF";
  isActive: number; posEnabled: number; hosEnabled?: number; employeePinHash: string | null; pinHash: string | null;
  kdsEnabled: number; kdsPinHash: string | null; kdsPasswordHash: string | null; kdsTotpSecretEnc: string | null;
  kdsPinChangeRequired: number; adminLoginId: string | null; adminPinHash: string | null; adminEnabled: number;
};

export function toStaffSummary(row: StaffRow): StaffSummary {
  return {
    staffId: row.staffId, loginId: row.adminLoginId, name: row.staffCode === "000" ? "매장 공용" : row.name,
    role: row.role, isActive: Number(row.isActive) === 1, posEnabled: Number(row.posEnabled) === 1,
    kdsEnabled: Number(row.kdsEnabled) === 1, hosEnabled: Number(row.hosEnabled) === 1,
    hasEmployeePin: Boolean(row.employeePinHash), hasLegacyPosPin: Boolean(row.pinHash), hasKdsPin: Boolean(row.kdsPinHash),
    hasKdsPassword: Boolean(row.kdsPasswordHash), hasKdsTotp: Boolean(row.kdsTotpSecretEnc),
    kdsPinChangeRequired: row.kdsPinChangeRequired === 1 && !row.employeePinHash,
    adminEnabled: row.adminEnabled === 1, hasLegacyAdminPin: Boolean(row.adminPinHash),
    isShared: row.staffCode === "000",
  };
}

export function parseStaffDraft(input: unknown, original?: StaffSummary) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (typeof body.name !== "string" || typeof body.loginId !== "string" || typeof body.role !== "string" || typeof body.isActive !== "boolean" ||
      typeof body.posEnabled !== "boolean" || typeof body.kdsEnabled !== "boolean" || typeof body.hosEnabled !== "boolean" ||
      typeof body.employeePin !== "string" || typeof body.employeePinConfirm !== "string" ||
      typeof body.adminEnabled !== "boolean") return null;
  const draft: StaffDraft = {
    name: body.name.trim(), loginId: body.loginId.trim().toLowerCase(), role: body.role as StaffDraft["role"], isActive: body.isActive,
    posEnabled: body.posEnabled, kdsEnabled: body.kdsEnabled, hosEnabled: body.hosEnabled,
    employeePin: body.employeePin, employeePinConfirm: body.employeePinConfirm,
    adminEnabled: body.adminEnabled,
  };
  const errors = validateStaffDraft(draft, original);
  return { draft, errors, valid: Object.keys(errors).length === 0 };
}

export function newInternalStaffCode() { return `AUTO-${randomBytes(12).toString("hex")}`; }
export function isDuplicateAdminLoginId(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string; sqlMessage?: string }; sqlMessage?: string };
  const message = candidate.cause?.sqlMessage ?? candidate.sqlMessage ?? "";
  return (candidate.code === "ER_DUP_ENTRY" || candidate.cause?.code === "ER_DUP_ENTRY") && message.includes("uq_staff_admin_login_id");
}
