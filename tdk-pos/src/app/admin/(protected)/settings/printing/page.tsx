import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getReceiptAutoPrintAfterPayment } from "@/lib/receipt-auto-print-setting";
import ReceiptAutoPrintSettingsForm from "@/app/pos/admin/settings/ReceiptAutoPrintSettingsForm";
import AdminReadOnlyFields from "@/app/admin/AdminReadOnlyFields";
import styles from "../../../admin.module.css";

export default async function AdminPrintingSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");
  const receiptAutoPrint = await getReceiptAutoPrintAfterPayment();

  return <div className={styles.content}>
    <div className="mx-auto max-w-xl">
      <div className={styles.pageHeading}>
        <div className="flex items-center gap-3">
          <Link aria-label="관리센터로 돌아가기" className="text-2xl font-semibold text-slate-700 hover:text-slate-900" href="/admin">←</Link>
          <h1>인쇄 설정</h1>
        </div>
      </div>
      <AdminReadOnlyFields><ReceiptAutoPrintSettingsForm initialEnabled={receiptAutoPrint} /></AdminReadOnlyFields>
    </div>
  </div>;
}
