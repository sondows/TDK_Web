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
  center?: ReactNode;
  titleId?: string;
  level?: 1 | 2;
  splitRatio?: boolean;
  className?: string;
  trailingClassName?: string;
  backIconSize?: number;
  backButtonSize?: number;
  backVisualSize?: number;
  showBackButton?: boolean;
  compact?: boolean;
};

export default function PosSubHeader({ title, onBack, backLabel, disabled = false, trailing, titleTrailing, center, titleId, level = 2, splitRatio = false, className = "", trailingClassName = "", backIconSize, backButtonSize = 46, backVisualSize, showBackButton = true, compact = false }: PosSubHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return <header className={`${compact ? "min-h-14 px-4 py-1" : "min-h-[70px] px-5 py-3"} shrink-0 items-center bg-[#455A64] text-white ${center ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3" : splitRatio ? "grid grid-cols-[30%_70%]" : "flex justify-between gap-4"} ${className}`}>
    <div className="flex min-w-0 items-center gap-3">
      {showBackButton && <AdminBackLink ariaLabel={backLabel ?? `${title} 닫기`} disabled={disabled} iconSize={backIconSize} onNavigate={onBack} size={backButtonSize} title={backLabel ?? `${title} 닫기`} tone="dark" visualSize={backVisualSize} />}
      <Heading className="min-w-0 truncate text-left text-2xl font-extrabold" id={titleId}>{title}</Heading>
      {titleTrailing}
    </div>
    {center && <div className="flex items-center justify-center">{center}</div>}
    {trailing && <div className={`flex min-w-0 items-center ${trailingClassName}`}>{trailing}</div>}
  </header>;
}
