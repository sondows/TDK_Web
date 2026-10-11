import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getReceiptLogoFileName } from "@/lib/receipt-logo-storage";
import { getStoreInfo } from "@/lib/store-info";
import StoreInfoForm from "@/app/pos/admin/settings/StoreInfoForm";
import styles from "../../../../admin.module.css";

export default async function AdminNameplateSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");
  const [storeInfo, logoFileName] = await Promise.all([getStoreInfo(), getReceiptLogoFileName()]);

  return <div className={styles.content}>
    <div className={styles.pageHeading}>
      <h1>매장 명판 설정</h1>
      <p className={styles.pageDescription}>영수증에 출력되는 매장 정보와 로고를 설정합니다.</p>
    </div>
    <StoreInfoForm initialStoreInfo={storeInfo} initialLogoFileName={logoFileName} />
  </div>;
}
