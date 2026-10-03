"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";

export default function AdminLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin-center/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout");
      router.replace("/admin/login");
      router.refresh();
    } catch {
      setError("로그아웃에 실패했습니다.");
      setBusy(false);
    }
  };
  return <><button className={styles.logoutButton} disabled={busy} onClick={() => void logout()} type="button">로그아웃</button>{error && <span className={styles.logoutError} role="alert">{error}</span>}</>;
}
