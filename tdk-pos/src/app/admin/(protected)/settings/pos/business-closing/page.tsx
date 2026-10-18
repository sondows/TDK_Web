import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { BUSINESS_CUTOFF_KEY, OPENING_CASH_ENABLED_KEY } from "@/lib/business-session";
import { isValidCutoffTime } from "@/lib/business-date";
import BusinessSettingsForm from "../BusinessSettingsForm";
import AdminReadOnlyFields from "@/app/admin/AdminReadOnlyFields";
import styles from "../../../../admin.module.css";

export default async function BusinessClosingSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");

  const [cutoffSetting, openingCashSetting] = await Promise.all([
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, BUSINESS_CUTOFF_KEY)).limit(1),
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, OPENING_CASH_ENABLED_KEY)).limit(1),
  ]);
  const storedValue = cutoffSetting[0]?.value ?? "06:00";
  const cutoffTime = isValidCutoffTime(storedValue) ? storedValue : "06:00";

  return <div className={styles.content}><div className="mx-auto max-w-xl">
    <div className={styles.pageHeading}>
      <h1>영업마감</h1>
      <p className={styles.pageDescription}>영업일 기준시간을 설정합니다.</p>
    </div>
    <AdminReadOnlyFields><BusinessSettingsForm initialCutoffTime={cutoffTime} initialOpeningCashEnabled={openingCashSetting[0]?.value === "1"} /></AdminReadOnlyFields>
  </div></div>;
}
