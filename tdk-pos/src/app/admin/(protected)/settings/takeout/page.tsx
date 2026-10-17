import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import {
  getTakeoutPreparationMinutes,
  maxTakeoutPreparationMinutes,
} from "@/lib/takeout-preparation-setting";
import styles from "../../../admin.module.css";
import TakeoutPreparationSettingsForm from "./TakeoutPreparationSettingsForm";

export default async function AdminTakeoutSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");
  const minutes = await getTakeoutPreparationMinutes();

  return <div className={styles.content}>
    <div className="mx-auto max-w-xl">
      <div className={styles.pageHeading}>
        <h1 className="select-none">포장 설정</h1>
      </div>
      <TakeoutPreparationSettingsForm initialMinutes={minutes} maxMinutes={maxTakeoutPreparationMinutes} />
    </div>
  </div>;
}
