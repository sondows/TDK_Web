import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export type StoreInfo = {
  storeName: string;
  businessNumber: string;
  representative: string;
  phone: string;
  address: string;
};

export const storeInfoSettingKeys: Record<keyof StoreInfo, string> = {
  storeName: "store_name",
  businessNumber: "store_business_number",
  representative: "store_representative",
  phone: "store_phone",
  address: "store_address",
};

export async function getStoreInfo(): Promise<StoreInfo> {
  const rows = await db.select({ key: systemSettings.settingKey, value: systemSettings.settingValue })
    .from(systemSettings)
    .where(inArray(systemSettings.settingKey, Object.values(storeInfoSettingKeys)));
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    storeName: settings.get(storeInfoSettingKeys.storeName) ?? "",
    businessNumber: settings.get(storeInfoSettingKeys.businessNumber) ?? "",
    representative: settings.get(storeInfoSettingKeys.representative) ?? "",
    phone: settings.get(storeInfoSettingKeys.phone) ?? "",
    address: settings.get(storeInfoSettingKeys.address) ?? "",
  };
}
