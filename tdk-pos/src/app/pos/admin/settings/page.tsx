import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getPrivilegedStaff } from "@/lib/permissions";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import IdleResetSettingsForm from "./IdleResetSettingsForm";
import ManagementPageHeader from "../ManagementPageHeader";

export default async function PosSettingsPage() {
  const [staff, loginMode, setting] = await Promise.all([
    getPrivilegedStaff(),
    getPosLoginMode(),
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_idle_reset_seconds")).limit(1),
  ]);
  if (!staff) redirect("/pos/admin");
  if (staff.role !== "OWNER") redirect("/pos");
  const seconds = Math.max(0, Number(setting[0]?.value ?? 60));

  return <main className="min-h-dvh bg-slate-100 p-6 text-slate-900"><ManagementPageHeader maxWidth="max-w-xl" title="매장 설정" /><IdleResetSettingsForm initialLoginMode={loginMode} initialSeconds={Number.isInteger(seconds) ? seconds : 60} /></main>;
}
