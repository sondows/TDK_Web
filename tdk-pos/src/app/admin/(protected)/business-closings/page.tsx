import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import BusinessClosingsClient from "./BusinessClosingsClient";
import styles from "../../admin.module.css";

export default async function BusinessClosingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");
  return <div className={styles.content}><div className="mx-auto max-w-5xl">
    <div className={styles.pageHeading}><h1>영업마감 내역</h1><p className={styles.pageDescription}>영업일별 합계와 각 영업세션의 마감 기록을 확인합니다.</p></div>
    <BusinessClosingsClient />
  </div></div>;
}
