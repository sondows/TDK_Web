import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES, isKdsCompletedTimeShrinkStartMinutes } from "@/lib/kds-model";

export const KDS_COMPLETED_TIME_SHRINK_SETTING_KEY = "kds_completed_time_shrink_start_minutes";

export async function getKdsCompletedTimeShrinkStartMinutes() {
  const [row] = await db.select({ value: systemSettings.settingValue })
    .from(systemSettings).where(eq(systemSettings.settingKey, KDS_COMPLETED_TIME_SHRINK_SETTING_KEY)).limit(1);
  const value = row ? Number(row.value) : DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES;
  return isKdsCompletedTimeShrinkStartMinutes(value) ? value : DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES;
}
