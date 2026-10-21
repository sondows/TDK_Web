import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { KDS_ARRIVAL_SOUND_SETTING_KEYS, parseKdsArrivalSoundSettings } from "@/lib/kds-arrival-sound";

export async function getKdsArrivalSoundSettings() {
  const keys = Object.values(KDS_ARRIVAL_SOUND_SETTING_KEYS);
  const rows = await db.select({ key: systemSettings.settingKey, value: systemSettings.settingValue })
    .from(systemSettings).where(inArray(systemSettings.settingKey, keys));
  return parseKdsArrivalSoundSettings(new Map(rows.map(row => [row.key, row.value])));
}
