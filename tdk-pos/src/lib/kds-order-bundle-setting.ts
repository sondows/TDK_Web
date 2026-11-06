import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { DEFAULT_KDS_ORDER_BUNDLE_SETTINGS, isKdsOrderBundleSettings, type KdsOrderBundleSettings } from "@/lib/kds-model";

export const KDS_ORDER_BUNDLE_SETTING_KEYS = {
  enabled: "kds_order_bundle_enabled",
  minutes: "kds_order_bundle_minutes",
} as const;

export async function getKdsOrderBundleSettings(): Promise<KdsOrderBundleSettings> {
  const rows = await db.select({ key: systemSettings.settingKey, value: systemSettings.settingValue })
    .from(systemSettings).where(inArray(systemSettings.settingKey, Object.values(KDS_ORDER_BUNDLE_SETTING_KEYS)));
  const values = new Map(rows.map(row => [row.key, row.value]));
  const minutes = Number(values.get(KDS_ORDER_BUNDLE_SETTING_KEYS.minutes) ?? DEFAULT_KDS_ORDER_BUNDLE_SETTINGS.minutes);
  const settings = {
    enabled: values.get(KDS_ORDER_BUNDLE_SETTING_KEYS.enabled) === "1",
    minutes,
  };
  return isKdsOrderBundleSettings(settings) ? settings : DEFAULT_KDS_ORDER_BUNDLE_SETTINGS;
}
