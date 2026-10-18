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
  backTone?: "dark" | "plain";
  showBackButton?: boolean;
  compact?: boolean;
  variant?: "modal" | "page";
};

export default function PosSubHeader({ title, onBack, backLabel, disabled = false, trailing, titleTrailing, center, titleId, level = 2, splitRatio = false, className = "", trailingClassName = "", backIconSize, backButtonSize, backVisualSize, backTone, showBackButton = true, compact = false, variant = "modal" }: PosSubHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return <header className={`${variant === "modal" ? "h-16 pl-1 pr-5" : compact ? "min-h-14 px-4 py-1" : "min-h-[70px] px-5 py-3"} shrink-0 items-center bg-[#455A64] text-white ${center ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3" : splitRatio ? "grid grid-cols-[30%_70%]" : "flex justify-between gap-4"} ${className}`}>
    <div className={`flex min-w-0 items-center ${variant === "modal" ? "gap-[15px]" : "gap-3"}`}>
      {showBackButton && <span className={`flex shrink-0 ${variant === "modal" ? "-mr-[13px]" : ""}`}><AdminBackLink ariaLabel={backLabel ?? `${title} 닫기`} disabled={disabled} iconSize={backIconSize ?? (variant === "modal" ? 28 : 24)} onNavigate={onBack} size={backButtonSize ?? (variant === "modal" ? 44 : 46)} title={backLabel ?? `${title} 닫기`} tone={backTone ?? (variant === "modal" ? "plain" : "dark")} visualSize={backVisualSize} /></span>}
      <Heading className="pos-modal-copy min-w-0 truncate text-left text-2xl font-extrabold" id={titleId}>{title}</Heading>
      {titleTrailing}
    </div>
    {center && <div className="flex items-center justify-center">{center}</div>}
    {trailing && <div className={`flex min-w-0 items-center ${trailingClassName}`}>{trailing}</div>}
  </header>;
}
