import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getConfiguredPosLoginMode } from "@/lib/pos-login-mode";
import { getPaymentAutoCompleteSeconds } from "@/lib/payment-auto-complete-setting";
import IdleResetSettingsForm from "@/app/pos/admin/settings/IdleResetSettingsForm";
import BusinessSettingsForm from "./BusinessSettingsForm";
import { BUSINESS_CUTOFF_KEY, OPENING_CASH_ENABLED_KEY } from "@/lib/business-session";
import styles from "../../../admin.module.css";

export default async function AdminPosSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");
  const [loginMode, setting, paymentAutoCompleteSeconds, businessSettingRows] = await Promise.all([
    getConfiguredPosLoginMode(),
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_idle_reset_seconds")).limit(1),
    getPaymentAutoCompleteSeconds(),
    db.select({ key: systemSettings.settingKey, value: systemSettings.settingValue }).from(systemSettings),
  ]);
  const seconds = Math.max(0, Number(setting[0]?.value ?? 60));
  const businessSettings = new Map(businessSettingRows.map(row => [row.key, row.value]));

  return <div className={styles.content}>
    <div className="mx-auto max-w-xl">
      <div className={styles.pageHeading}>
        <h1>POS 설정</h1>
        <p className={styles.pageDescription}>POS 사용 및 동작 방식을 설정합니다.</p>
      </div>
      <IdleResetSettingsForm initialLoginMode={loginMode} initialSeconds={Number.isInteger(seconds) ? seconds : 60} initialPaymentAutoCompleteSeconds={paymentAutoCompleteSeconds} />
      <BusinessSettingsForm initialCutoffTime={businessSettings.get(BUSINESS_CUTOFF_KEY) ?? "06:00"} initialOpeningCashEnabled={businessSettings.get(OPENING_CASH_ENABLED_KEY) === "1"} />
    </div>
  </div>;
}
