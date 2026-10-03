"use client";

import { useRef } from "react";
import { PIN_LENGTH } from "@/lib/pin";

type PinInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  onComplete?: (value: string) => void;
  ariaLabel: string;
  label?: string;
  className?: string;
  keypadAligned?: boolean;
  autoComplete?: "current-password" | "new-password" | "one-time-code";
};

export default function PinInput({ value, onChange, disabled = false, autoFocus = false, onComplete, ariaLabel, label, className = "", keypadAligned = false, autoComplete = "one-time-code" }: PinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const update = (rawValue: string) => {
    const next = rawValue.replace(/\D/g, "").slice(0, PIN_LENGTH);
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  };

  const dots = Array.from({ length: PIN_LENGTH }, (_, index) => <span className={`size-5 rounded-full border ${index < value.length ? "border-slate-700 bg-slate-700" : "border-slate-400 bg-slate-50"}`} key={index} />);

  return <div className={`relative flex w-full rounded-xl border border-slate-300 bg-white transition focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-200 disabled:opacity-50 ${keypadAligned ? "min-h-[52px] flex-col justify-center py-1.5" : "mt-2 min-h-14 items-center px-5"} ${className}`} onClick={() => inputRef.current?.focus()}>
    {keypadAligned ? <div aria-hidden="true" className="absolute inset-x-0 top-1/2 flex h-5 -translate-y-1/2 items-center justify-between" style={{ paddingInline: "calc((100% - 0.5rem) / 6 - 0.625rem)" }}>{dots}</div> : <>
      {label && <span className="shrink-0 text-lg font-extrabold text-slate-700">{label}</span>}
      <div aria-hidden="true" className="flex min-h-14 flex-1 items-center justify-center gap-4">{dots}</div>
    </>}
    <input aria-label={ariaLabel} autoComplete={autoComplete} autoFocus={autoFocus} className="absolute inset-0 h-full w-full cursor-text opacity-0" disabled={disabled} inputMode="numeric" maxLength={PIN_LENGTH} onChange={event => update(event.target.value)} pattern="[0-9]*" type="password" value={value} />
  </div>;
}
