import HosHome from "./HosHome";
import HosLogin from "./HosLogin";
import { getCurrentHosStaff } from "@/lib/hos-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function HosPage() {
  const staff = await getCurrentHosStaff();
  if (!staff) return <HosLogin />;
  const idleResetSetting = await db.select({ value: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, "pos_idle_reset_seconds")).limit(1);
  const configuredIdleResetSeconds = Number(idleResetSetting[0]?.value ?? 60);
  const idleResetSeconds = Number.isInteger(configuredIdleResetSeconds) && configuredIdleResetSeconds >= 0 ? configuredIdleResetSeconds : 0;
  return <HosHome idleResetSeconds={idleResetSeconds} staffLoginId={staff.loginId} />;
}
