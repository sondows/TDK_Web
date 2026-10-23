import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS, isKdsCompletionCountdownSeconds } from "@/lib/kds-model";

export const KDS_COMPLETION_COUNTDOWN_SETTING_KEY = "kds_completion_countdown_seconds";

export async function getKdsCompletionCountdownSeconds() {
  const [row] = await db.select({ value: systemSettings.settingValue })
    .from(systemSettings).where(eq(systemSettings.settingKey, KDS_COMPLETION_COUNTDOWN_SETTING_KEY)).limit(1);
  const value = row ? Number(row.value) : DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS;
  return isKdsCompletionCountdownSeconds(value) ? value : DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS;
}
