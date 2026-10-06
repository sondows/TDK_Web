import { redirect } from "next/navigation";

export default function LegacyPosDiscountSettingsPage() {
  redirect("/admin/settings/discounts");
}
