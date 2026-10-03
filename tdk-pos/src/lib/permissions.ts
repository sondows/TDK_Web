import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { type CurrentStaff, getCurrentStaff } from "@/lib/auth";

export const ADMIN_GRANT_COOKIE = "tdk_pos_admin_grant";
const grantSecret = process.env.ADMIN_GRANT_SECRET ?? process.env.AUTH_SECRET ?? "tdk-pos-development-admin-grant";
const maxGrantAgeSeconds = 10 * 60;
export type StaffRole = CurrentStaff["role"];

const sign = (payload: string) => createHmac("sha256", grantSecret).update(payload).digest("base64url");

export function createAdminGrant(staffId: number) {
  const payload = `${staffId}.${Date.now() + maxGrantAgeSeconds * 1000}`;
  return `${payload}.${sign(payload)}`;
}

export async function getPrivilegedStaff(): Promise<CurrentStaff | null> {
  const granted = await getAdminGrantedStaff();
  if (granted) return granted;
  const loggedIn = await getCurrentStaff();
  if (loggedIn && loggedIn.staffCode !== "000") return loggedIn;
  return null;
}

/** Uses a recent administrator PIN grant even if a different POS employee is logged in. */
export async function getAdminGrantedStaff(): Promise<CurrentStaff | null> {
  const token = (await cookies()).get(ADMIN_GRANT_COOKIE)?.value;
  if (!token) return null;
  const [staffIdText, expiryText, signature] = token.split(".");
  const payload = `${staffIdText}.${expiryText}`;
  if (!staffIdText || !expiryText || !signature || Date.now() > Number(expiryText)) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const [member] = await db.select({ staffId: staff.staffId, staffCode: staff.staffCode, name: staff.name, role: staff.role }).from(staff).where(and(eq(staff.staffId, Number(staffIdText)), eq(staff.isActive, 1), ne(staff.staffCode, "000"))).limit(1);
  return member ?? null;
}

export const canManageStaff = (role: StaffRole) => role === "OWNER";
export const canManageMenu = (role: StaffRole) => role === "OWNER" || role === "MANAGER";
export const canManageCustomers = (role: StaffRole) => role === "OWNER" || role === "MANAGER";
export const canManageSettings = (role: StaffRole) => role === "OWNER";
export const canViewSales = (role: StaffRole) => role === "OWNER" || role === "MANAGER";
