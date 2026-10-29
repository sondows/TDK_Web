import { redirect } from "next/navigation";
import { db } from "@/db";
import { diningTables } from "@/db/schema";
import { resolveTableLayout } from "@/lib/table-layout";
import LayoutEditor from "@/app/pos/layout/LayoutEditor";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import styles from "../../admin.module.css";

export default async function AdminTablesPage() {
  const member = await getCurrentAdminStaff();
  if (!member) redirect("/tdkadm/login");
  const tables = await db.select().from(diningTables).orderBy(diningTables.sortOrder);
  return <div className={styles.content}>
    <div className={styles.pageHeading}>
      <h1>테이블 설정</h1>
      <p className={styles.pageDescription}>POS 메인 화면과 테이블 관리 화면에 사용할 테이블 배치를 설정합니다.</p>
    </div>
    <LayoutEditor embedded returnPath="/tdkadm" tables={tables.map((table, index) => ({ ...table, ...resolveTableLayout({ positionX: table.positionX === null ? undefined : Number(table.positionX), positionY: table.positionY === null ? undefined : Number(table.positionY), layoutWidth: table.layoutWidth === null ? undefined : Number(table.layoutWidth), layoutHeight: table.layoutHeight === null ? undefined : Number(table.layoutHeight), rotation: table.rotation }, index) }))} />
  </div>;
}
