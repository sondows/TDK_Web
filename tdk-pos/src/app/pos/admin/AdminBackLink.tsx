"use client";

import { useRouter } from "next/navigation";

export default function AdminBackLink({ onNavigate, ariaLabel = "관리로 돌아가기", title = "관리로 돌아가기", disabled = false, tone = "default", size = 46, iconSize = 24, visualSize = size }: { onNavigate?: () => void; ariaLabel?: string; title?: string; disabled?: boolean; tone?: "default" | "dark"; size?: number; iconSize?: number; visualSize?: number }) {
  const router = useRouter();
  const color = tone === "dark"
    ? "border-transparent bg-white text-[#455A64] hover:bg-slate-100 active:bg-slate-200 focus:ring-white focus:ring-offset-[#455A64]"
    : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 focus:ring-slate-400 focus:ring-offset-2";
  const icon = <svg aria-hidden="true" fill="none" height={iconSize} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={iconSize}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>;
  const visual = visualSize === size ? icon : <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full border transition ${color}`} style={{ width: visualSize, height: visualSize }}>{icon}</span>;
  return <button aria-label={ariaLabel} className={`flex shrink-0 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 disabled:opacity-50 ${visualSize === size ? color : "border-transparent bg-transparent focus:ring-white focus:ring-offset-[#455A64]"}`} disabled={disabled} onClick={() => onNavigate ? onNavigate() : router.push("/admin")} style={{ width: size, height: size }} title={title} type="button">{visual}</button>;
}
