import { redirect } from "next/navigation";

export default function LegacyPosStoreSettingsPage() {
  redirect("/admin/settings/store");
}
