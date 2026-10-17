import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export const takeoutPreparationSettingKey = "takeout_preparation_minutes";
export const defaultTakeoutPreparationMinutes = 20;
export const maxTakeoutPreparationMinutes = 1440;

export function isValidTakeoutPreparationMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value > 0 && value <= maxTakeoutPreparationMinutes;
}

export async function getTakeoutPreparationMinutes(): Promise<number> {
  const [setting] = await db.select({ value: systemSettings.settingValue })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, takeoutPreparationSettingKey))
    .limit(1);
  const minutes = Number(setting?.value ?? defaultTakeoutPreparationMinutes);
  return isValidTakeoutPreparationMinutes(minutes) ? minutes : defaultTakeoutPreparationMinutes;
}
