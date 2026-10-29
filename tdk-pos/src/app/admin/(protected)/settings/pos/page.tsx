import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getPaymentAutoCompleteSeconds } from "@/lib/payment-auto-complete-setting";
import IdleResetSettingsForm from "@/app/pos/admin/settings/IdleResetSettingsForm";
import styles from "../../../admin.module.css";

export default async function AdminPosSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/tdkadm/login");
  const [setting, paymentAutoCompleteSeconds] = await Promise.all([
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_idle_reset_seconds")).limit(1),
    getPaymentAutoCompleteSeconds(),
  ]);
  const seconds = Math.max(0, Number(setting[0]?.value ?? 60));

  return <div className={styles.content}>
    <div className="mx-auto max-w-xl">
      <div className={styles.pageHeading}>
        <h1>POS 설정</h1>
        <p className={styles.pageDescription}>POS 사용 및 동작 방식을 설정합니다.</p>
      </div>
      <IdleResetSettingsForm initialSeconds={Number.isInteger(seconds) ? seconds : 60} initialPaymentAutoCompleteSeconds={paymentAutoCompleteSeconds} />
    </div>
  </div>;
}
