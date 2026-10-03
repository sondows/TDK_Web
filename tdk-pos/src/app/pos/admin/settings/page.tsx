import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { canManageSettings, getPrivilegedStaff } from "@/lib/permissions";
import { getConfiguredPosLoginMode } from "@/lib/pos-login-mode";
import { getReceiptLogoFileName } from "@/lib/receipt-logo-storage";
import { getStoreInfo } from "@/lib/store-info";
import IdleResetSettingsForm from "./IdleResetSettingsForm";
import StoreInfoForm from "./StoreInfoForm";
import ManagementPageHeader from "../ManagementPageHeader";

export default async function PosSettingsPage() {
  const staff = await getPrivilegedStaff();
  if (!staff) redirect("/pos/admin");
  if (!canManageSettings(staff.role) || staff.staffCode === "000") redirect("/pos");
  const [loginMode, setting, storeInfo, logoFileName] = await Promise.all([
    getConfiguredPosLoginMode(),
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_idle_reset_seconds")).limit(1),
    getStoreInfo(),
    getReceiptLogoFileName(),
  ]);
  const seconds = Math.max(0, Number(setting[0]?.value ?? 60));

  return <main className="min-h-dvh bg-slate-100 p-6 text-slate-900"><ManagementPageHeader maxWidth="max-w-3xl" title="매장 설정" /><StoreInfoForm initialStoreInfo={storeInfo} initialLogoFileName={logoFileName} /><IdleResetSettingsForm initialLoginMode={loginMode} initialSeconds={Number.isInteger(seconds) ? seconds : 60} /></main>;
}
