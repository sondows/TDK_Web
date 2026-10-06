import { asc, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { discountRules } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import DiscountSettingsClient from "@/app/pos/admin/discounts/DiscountSettingsClient";
import styles from "../../../admin.module.css";

export default async function AdminDiscountSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");
  const presets = await db.select({ slot: discountRules.posPresetSlot, title: discountRules.discountName, type: discountRules.discountType, value: discountRules.discountValue, isActive: discountRules.isActive }).from(discountRules).where(isNotNull(discountRules.posPresetSlot)).orderBy(asc(discountRules.posPresetSlot));
  return <div className={styles.content}><div className={styles.pageHeading}><h1>할인 설정</h1><p className={styles.pageDescription}>POS 현장 할인 버튼의 기준 금액과 할인율을 관리합니다.</p></div><DiscountSettingsClient initialPresets={presets} /></div>;
}
