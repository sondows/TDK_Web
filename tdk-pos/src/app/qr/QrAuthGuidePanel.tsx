"use client";

import Image from "next/image";
import { useState } from "react";
import type { QrAuthGuide } from "@/lib/qr-auth-guide-model";

const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "←", "0", "C"];

function MonitorPhoto({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return <div className="relative mx-auto h-[min(20dvh,9rem)] w-full overflow-hidden rounded-xl bg-slate-50">
    {src && !failed
      ? <Image alt="매장 인증 모니터 위치" className="object-contain" fill onError={() => setFailed(true)} sizes="(max-width: 448px) 100vw, 408px" src={src} unoptimized />
      : <div className="grid h-full place-content-center justify-items-center gap-1 text-xs font-medium text-slate-600">
        <span aria-hidden="true" className="h-7 w-11 rounded border-2 border-slate-400" />
        매장 인증 모니터
      </div>}
  </div>;
}

export default function QrAuthGuidePanel({ guide, code = "", disabled = false, closeDisabled = false, titleId, onClose, onKey, children }: {
  guide: QrAuthGuide;
  code?: string;
  disabled?: boolean;
  closeDisabled?: boolean;
  titleId?: string;
  onClose?: () => void;
  onKey?: (key: string) => void;
  children?: React.ReactNode;
}) {
  return <>
    <div className="mb-3 flex items-center gap-2">
      <h2 className="min-w-0 flex-1 break-words text-lg font-extrabold text-slate-900" id={titleId}>{guide.title}</h2>
      {onClose && <button aria-label="닫기" className="size-11 shrink-0 rounded-full bg-slate-100 text-xl text-slate-700 disabled:opacity-50" disabled={closeDisabled} onClick={onClose} type="button">×</button>}
    </div>
    <MonitorPhoto key={guide.imageUrl} src={guide.imageUrl} />
    <p className="mt-3 break-words text-center text-sm font-semibold text-slate-700">{guide.message}</p>
    <div aria-label={`인증번호 두 자리 중 ${code.length}자리 입력됨`} aria-live="polite" className="my-3 flex justify-center gap-2" role="status">
      {[0, 1].map(index => <span aria-hidden="true" className="grid size-11 place-items-center rounded-lg border border-slate-300 bg-slate-50 text-2xl font-extrabold tabular-nums text-slate-900" key={index}>{code[index]}</span>)}
    </div>
    <div aria-label="인증번호 숫자 키패드" className="grid grid-cols-3 gap-1.5" role="group">
      {keys.map(key => <button
        aria-label={key === "←" ? "한 자리 지우기" : key === "C" ? "모두 지우기" : undefined}
        className="min-h-11 touch-manipulation rounded-lg bg-slate-100 text-lg font-bold text-slate-900 active:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-60"
        disabled={disabled || !onKey} key={key} onClick={() => onKey?.(key)} type="button">{key}</button>)}
    </div>
    {children}
  </>;
}
