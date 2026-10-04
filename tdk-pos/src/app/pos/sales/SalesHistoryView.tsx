import { redirect } from "next/navigation";

import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import PosPage from "../page";
import SalesHistoryClient from "./SalesHistoryClient";

export default async function SalesHistoryView({ closeToPos = false }: { closeToPos?: boolean }) {
  const [staff, loginMode] = await Promise.all([getCurrentStaff(), getPosLoginMode()]);
  if (!staff && loginMode !== "SHARED") redirect("/login");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return <>
    {closeToPos && staff && <PosPage />}
    <SalesHistoryClient closeToPos={closeToPos} date={today} />
  </>;
}
