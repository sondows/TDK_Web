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
  autoComplete?: "current-password" | "new-password" | "one-time-code";
};

export default function PinInput({ value, onChange, disabled = false, autoFocus = false, onComplete, ariaLabel, label, className = "", autoComplete = "one-time-code" }: PinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const update = (rawValue: string) => {
    const next = rawValue.replace(/\D/g, "").slice(0, PIN_LENGTH);
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  };

  return <div className={`relative mt-2 flex min-h-14 w-full items-center rounded-xl border border-slate-300 bg-white px-5 transition focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-200 disabled:opacity-50 ${className}`} onClick={() => inputRef.current?.focus()}>
    {label && <span className="shrink-0 text-lg font-extrabold text-slate-700">{label}</span>}
    <div aria-hidden="true" className="flex min-h-14 flex-1 items-center justify-center gap-4">
      {Array.from({ length: PIN_LENGTH }, (_, index) => <span className={`size-5 rounded-full border ${index < value.length ? "border-slate-700 bg-slate-700" : "border-slate-400 bg-slate-50"}`} key={index} />)}
    </div>
    <input aria-label={ariaLabel} autoComplete={autoComplete} autoFocus={autoFocus} className="absolute inset-0 h-full w-full cursor-text opacity-0" disabled={disabled} inputMode="numeric" maxLength={PIN_LENGTH} onChange={event => update(event.target.value)} pattern="[0-9]*" type="password" value={value} />
  </div>;
}
