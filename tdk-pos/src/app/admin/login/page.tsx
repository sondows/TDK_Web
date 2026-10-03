import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import AdminLoginForm from "./AdminLoginForm";
import styles from "../admin.module.css";

export default async function AdminLoginPage() {
  if (await getCurrentAdminStaff()) redirect("/admin");
  return <main className={styles.loginScreen}><AdminLoginForm /></main>;
}
