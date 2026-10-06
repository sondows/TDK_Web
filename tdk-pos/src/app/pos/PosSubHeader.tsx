"use client";

import type { ReactNode } from "react";
import AdminBackLink from "./admin/AdminBackLink";

type PosSubHeaderProps = {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  disabled?: boolean;
  trailing?: ReactNode;
  titleTrailing?: ReactNode;
  titleId?: string;
  level?: 1 | 2;
  splitRatio?: boolean;
  className?: string;
  trailingClassName?: string;
  backIconSize?: number;
  backVisualSize?: number;
  showBackButton?: boolean;
};

export default function PosSubHeader({ title, onBack, backLabel, disabled = false, trailing, titleTrailing, titleId, level = 2, splitRatio = false, className = "", trailingClassName = "", backIconSize, backVisualSize, showBackButton = true }: PosSubHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return <header className={`min-h-[70px] shrink-0 items-center bg-[#455A64] px-5 py-3 text-white ${splitRatio ? "grid grid-cols-[30%_70%]" : "flex justify-between gap-4"} ${className}`}>
    <div className="flex min-w-0 items-center gap-3">
      {showBackButton && <AdminBackLink ariaLabel={backLabel ?? `${title} 닫기`} disabled={disabled} iconSize={backIconSize} onNavigate={onBack} size={46} title={backLabel ?? `${title} 닫기`} tone="dark" visualSize={backVisualSize} />}
      <Heading className="min-w-0 truncate text-left text-2xl font-extrabold" id={titleId}>{title}</Heading>
      {titleTrailing}
    </div>
    {trailing && <div className={`flex min-w-0 items-center ${trailingClassName}`}>{trailing}</div>}
  </header>;
}
