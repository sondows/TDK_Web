import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import {
  DEFAULT_KDS_COOKING_SETTINGS,
  isKdsCookingSettings,
  type KdsCookingSettings,
} from "@/lib/kds-model";

export const KDS_COOKING_SETTING_KEYS = {
  first: "kds_boil_time_1",
  second: "kds_boil_time_2",
  third: "kds_boil_time_3",
  default: "kds_boil_time_default",
} as const;

export async function getKdsCookingSettings(): Promise<KdsCookingSettings> {
  const keys = Object.values(KDS_COOKING_SETTING_KEYS);
  const rows = await db.select({ key: systemSettings.settingKey, value: systemSettings.settingValue })
    .from(systemSettings).where(inArray(systemSettings.settingKey, keys));
  const values = new Map(rows.map(row => [row.key, Number(row.value)]));
  const settings = {
    boilTimeOptions: [
      values.get(KDS_COOKING_SETTING_KEYS.first) ?? DEFAULT_KDS_COOKING_SETTINGS.boilTimeOptions[0],
      values.get(KDS_COOKING_SETTING_KEYS.second) ?? DEFAULT_KDS_COOKING_SETTINGS.boilTimeOptions[1],
      values.get(KDS_COOKING_SETTING_KEYS.third) ?? DEFAULT_KDS_COOKING_SETTINGS.boilTimeOptions[2],
    ],
    defaultBoilTimeMinutes: values.get(KDS_COOKING_SETTING_KEYS.default) ?? DEFAULT_KDS_COOKING_SETTINGS.defaultBoilTimeMinutes,
  };
  return isKdsCookingSettings(settings) ? settings : DEFAULT_KDS_COOKING_SETTINGS;
}
