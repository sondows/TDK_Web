import { asc, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { discountRules } from "@/db/schema";
import { canManageSettings, getPrivilegedStaff } from "@/lib/permissions";
import ManagementPageHeader from "../ManagementPageHeader";
import DiscountSettingsClient from "./DiscountSettingsClient";

export default async function DiscountSettingsPage() {
  const staff = await getPrivilegedStaff();
  if (!staff) redirect("/pos/admin");
  if (!canManageSettings(staff.role)) redirect("/pos");
  const presets = await db.select({ slot: discountRules.posPresetSlot, title: discountRules.discountName, type: discountRules.discountType, value: discountRules.discountValue, isActive: discountRules.isActive })
    .from(discountRules).where(isNotNull(discountRules.posPresetSlot)).orderBy(asc(discountRules.posPresetSlot));
  return <main className="min-h-dvh bg-slate-100 p-6 text-slate-900"><ManagementPageHeader maxWidth="max-w-3xl" title="할인 설정" /><DiscountSettingsClient initialPresets={presets} /></main>;
}
