import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export type PosLoginMode = "PERSONAL" | "SHARED";

export async function getPosLoginMode(): Promise<PosLoginMode> {
  const [setting] = await db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_login_mode")).limit(1);
  return setting?.value === "SHARED" ? "SHARED" : "PERSONAL";
}
