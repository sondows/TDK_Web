import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";

export type PosLoginMode = "PERSONAL" | "SHARED";

/** Store setting used by the login screen, before a POS session exists. */
export async function getConfiguredPosLoginMode(): Promise<PosLoginMode> {
  const [setting] = await db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_login_mode")).limit(1);
  return setting?.value === "SHARED" ? "SHARED" : "PERSONAL";
}

/** SHARED access is granted only after an actual staff PIN login created a POS session. */
export async function getPosLoginMode(): Promise<PosLoginMode> {
  const configuredMode = await getConfiguredPosLoginMode();
  return configuredMode === "SHARED" && await getCurrentStaff() ? "SHARED" : "PERSONAL";
}
