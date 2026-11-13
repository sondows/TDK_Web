import { redirect } from "next/navigation";
import AdminWorkspaceShell from "../AdminWorkspaceShell";
import styles from "../admin.module.css";
import { getCurrentAdminStaff, getOwnerSecurityState } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { getQrBusinessHoursSettings } from "@/lib/qr-title-settings";
import QrBusinessHoursSettings from "../qr/title/QrBusinessHoursSettings";

export const dynamic = "force-dynamic";

export default async function BusinessHoursPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");
  const ownerSecurityState = await getOwnerSecurityState();

  let weekly: Awaited<ReturnType<typeof getQrBusinessHoursSettings>>["weekly"] = [];
  let specialHours: Awaited<ReturnType<typeof getQrBusinessHoursSettings>>["specialHours"] = [];
  let businessHoursMode: Awaited<ReturnType<typeof getQrBusinessHoursSettings>>["businessHoursMode"] = "WEEKLY";
  let closedDates: Awaited<ReturnType<typeof getQrBusinessHoursSettings>>["closedDates"] = [];
  let holidayRules: Awaited<ReturnType<typeof getQrBusinessHoursSettings>>["holidayRules"] = [];
  let todayOverride: Awaited<ReturnType<typeof getQrBusinessHoursSettings>>["todayOverride"] = null;
  let error = "";
  try {
    const hours = await getQrBusinessHoursSettings();
    weekly = hours.weekly;
    specialHours = hours.specialHours;
    businessHoursMode = hours.businessHoursMode;
    closedDates = hours.closedDates;
    holidayRules = hours.holidayRules;
    todayOverride = hours.todayOverride;
  } catch {
    error = "영업시간 설정을 불러오지 못했습니다. 화면을 새로고침해 주세요.";
  }

  return <AdminWorkspaceShell canManageMenu userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>영업시간설정</h1><p className={styles.pageDescription}>저장한 영업시간은 매장 운영과 /qr 및 /qr/wait 고객 화면에 공통 적용됩니다.</p></div>
      <QrBusinessHoursSettings initialWeekly={weekly} initialSpecialHours={specialHours} initialBusinessHoursMode={businessHoursMode} initialClosedDates={closedDates} initialHolidayRules={holidayRules} initialTodayOverride={todayOverride} ownerSecurityState={ownerSecurityState} initialError={error} />
    </div>
  </AdminWorkspaceShell>;
}
