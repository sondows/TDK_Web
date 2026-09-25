import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageMenu, canManageSettings, canManageStaff, getPrivilegedStaff } from "@/lib/permissions";
import AdminVerifyGate from "./AdminVerifyGate";
import AdminExitButton from "./AdminExitButton";

export default async function AdminPage() {
  const staff = await getPrivilegedStaff();
  if (!staff) return <AdminVerifyGate />;
  const items = [
    { name: "테이블 배치", href: "/pos/layout", allowed: staff.role === "OWNER" },
    { name: "메뉴 관리", href: "/pos/admin/menus", allowed: canManageMenu(staff.role) },
    { name: "직원 관리", href: "/pos/admin/staff", allowed: canManageStaff(staff.role) },
    { name: "매장 설정", href: "/pos/admin/settings", allowed: canManageSettings(staff.role) },
    { name: "할인 설정", href: "/pos/admin/discounts", allowed: canManageSettings(staff.role) },
  ];
  if (!items.some(item => item.allowed)) redirect("/pos");
  return <main className="min-h-dvh bg-slate-100 p-6 text-slate-900"><header className="mx-auto flex max-w-3xl items-center gap-4"><AdminExitButton /><div><p className="text-sm font-bold text-blue-600">TDK POS</p><h1 className="text-2xl font-bold">관리</h1><p className="mt-1 text-sm text-slate-500">{staff.name} · {staff.role}</p></div></header><section className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-2">{items.filter(item=>item.allowed).map(item=><Link className="rounded-xl bg-white p-6 text-lg font-bold shadow-sm transition hover:ring-2 hover:ring-blue-500" href={item.href} key={item.name}>{item.name}</Link>)}</section></main>;
}
