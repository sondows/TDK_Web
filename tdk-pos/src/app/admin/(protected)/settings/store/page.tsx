import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getConfiguredPosLoginMode } from "@/lib/pos-login-mode";
import { getReceiptLogoFileName } from "@/lib/receipt-logo-storage";
import { getStoreInfo } from "@/lib/store-info";
import IdleResetSettingsForm from "@/app/pos/admin/settings/IdleResetSettingsForm";
import StoreInfoForm from "@/app/pos/admin/settings/StoreInfoForm";
import styles from "../../../admin.module.css";

export default async function AdminStoreSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");
  const [loginMode, setting, storeInfo, logoFileName] = await Promise.all([
    getConfiguredPosLoginMode(),
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_idle_reset_seconds")).limit(1),
    getStoreInfo(), getReceiptLogoFileName(),
  ]);
  const seconds = Math.max(0, Number(setting[0]?.value ?? 60));
  return <div className={styles.content}><div className={styles.pageHeading}><h1>매장 설정</h1><p className={styles.pageDescription}>매장 정보, POS 로그인 방식과 자동 초기화 설정을 관리합니다.</p></div><StoreInfoForm initialStoreInfo={storeInfo} initialLogoFileName={logoFileName} /><IdleResetSettingsForm initialLoginMode={loginMode} initialSeconds={Number.isInteger(seconds) ? seconds : 60} /></div>;
}
