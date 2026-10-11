import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export const receiptAutoPrintSettingKey = "receipt_auto_print_after_payment";

export async function getReceiptAutoPrintAfterPayment(): Promise<boolean> {
  const [setting] = await db.select({ value: systemSettings.settingValue })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, receiptAutoPrintSettingKey))
    .limit(1);
  return setting?.value === "1";
}
