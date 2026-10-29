import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { OPENING_CASH_ENABLED_KEY } from "@/lib/business-session";
import BusinessSettingsForm from "../BusinessSettingsForm";
import CashHistoryClient from "./CashHistoryClient";
import styles from "../../../../admin.module.css";

export default async function BusinessClosingSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/tdkadm/login");

  const openingCashSetting = await db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, OPENING_CASH_ENABLED_KEY)).limit(1);

  return <div className={styles.content}>
    <div className={styles.pageHeading}>
      <h1>영업마감</h1>
      <p className={styles.pageDescription}>달력 날짜별 정산에 사용할 준비금 설정입니다.</p>
    </div>
    <div className="max-w-xl"><BusinessSettingsForm initialOpeningCashEnabled={openingCashSetting[0]?.value === "1"} /></div>
    <CashHistoryClient />
  </div>;
}
