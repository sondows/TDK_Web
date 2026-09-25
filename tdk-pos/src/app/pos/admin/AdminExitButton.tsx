"use client";

import { useRouter } from "next/navigation";
import AdminBackLink from "./AdminBackLink";

export default function AdminExitButton() {
  const router = useRouter();

  const exitManagement = async () => {
    try {
      await fetch("/api/admin/grant", { method: "DELETE" });
    } finally {
      router.push("/pos");
    }
  };

  return <AdminBackLink ariaLabel="POS로 돌아가기" onNavigate={() => void exitManagement()} title="POS로 돌아가기" />;
}
