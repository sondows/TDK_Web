"use client";

import { useRouter } from "next/navigation";

export default function AdminBackLink({ onNavigate, ariaLabel = "관리로 돌아가기", title = "관리로 돌아가기", disabled = false }: { onNavigate?: () => void; ariaLabel?: string; title?: string; disabled?: boolean }) {
  const router = useRouter();
  return <button aria-label={ariaLabel} className="flex size-[46px] shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 transition hover:bg-slate-200 active:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:opacity-50" disabled={disabled} onClick={() => onNavigate ? onNavigate() : router.push("/pos/admin")} title={title} type="button"><svg aria-hidden="true" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="24"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg></button>;
}
