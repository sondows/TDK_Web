"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return <button aria-label="로그아웃" className="px-2 py-1 text-sm font-semibold text-red-600 hover:text-red-700 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-red-500" onClick={handleLogout} type="button">로그아웃</button>;
}
