"use client";

import type { ReactNode } from "react";
import AdminBackLink from "./AdminBackLink";

export default function ManagementPageHeader({ title, actions, onBack, maxWidth = "max-w-5xl", splitRatio = false }: { title: string; actions?: ReactNode; onBack?: () => void; maxWidth?: string; splitRatio?: boolean }) {
  return <header className={`mx-auto min-h-[76px] ${maxWidth} ${splitRatio ? "grid grid-cols-[30%_70%]" : "flex items-center justify-between gap-4"}`}><div className="flex min-w-0 items-center gap-4"><AdminBackLink onNavigate={onBack} /><div><p className="text-sm font-bold text-blue-600">TDK POS</p><h1 className="mt-1 text-2xl font-bold">{title}</h1></div></div>{actions && <div className={`min-w-0 ${splitRatio ? "flex items-center" : "flex shrink-0 items-center gap-3"}`}>{actions}</div>}</header>;
}
