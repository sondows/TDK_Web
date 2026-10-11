import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export const paymentAutoCompleteSettingKey = "payment_auto_complete_seconds";
export const defaultPaymentAutoCompleteSeconds = 30;

export async function getPaymentAutoCompleteSeconds(): Promise<number> {
  const [setting] = await db.select({ value: systemSettings.settingValue })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, paymentAutoCompleteSettingKey))
    .limit(1);
  const seconds = Number(setting?.value ?? defaultPaymentAutoCompleteSeconds);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : defaultPaymentAutoCompleteSeconds;
}
