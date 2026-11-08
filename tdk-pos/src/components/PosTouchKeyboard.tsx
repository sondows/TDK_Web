"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";

export type PosKeyboardMode = "id" | "master" | "pin";

type Props = {
  mode: PosKeyboardMode;
  onText: (text: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onConfirm: () => void;
  onClose: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
};

const keyClass = "min-h-11 min-w-0 touch-manipulation rounded-lg border border-slate-300 bg-white px-1 text-sm font-semibold text-slate-800 shadow-sm active:bg-blue-100";
const qwertyRows = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];
const numberRow = [..."1234567890"];
const symbolRows = [
  [..."!@#$%^&*()"],
  ["-", "_", "=", "+", "[", "]", "{", "}", ";", ":"],
  ["'", '"', ",", ".", "<", ">", "/", "?", "\\", "|"],
];

export default function PosTouchKeyboard({ mode, onText, onBackspace, onClear, onConfirm, onClose,
  actionLabel = "확인", actionDisabled = false }: Props) {
  const [shifted, setShifted] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const keepInputFocused = (event: ReactPointerEvent<HTMLButtonElement>) => event.preventDefault();

  const key = (value: string, label = value, className = "") => <button aria-label={label}
    className={`${keyClass} ${className}`} key={`${label}-${value}`} onClick={() => onText(value)}
    onPointerDown={keepInputFocused} type="button">{label}</button>;

  if (mode === "pin") return <section aria-label="PIN 화상 키보드"
    className="mx-auto w-full max-w-[320px] rounded-2xl border border-slate-200 bg-white p-3 shadow-lg"
    data-pos-touch-keyboard>
    <div className="grid grid-cols-3 gap-1.5">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "⌫"].map(value =>
        <button className={`${keyClass} min-h-12 text-base`} key={value}
          onClick={() => value === "⌫" ? onBackspace() : value === "지움" ? onClear() : onText(value)}
          onPointerDown={keepInputFocused} type="button">{value}</button>)}
      <button className="col-span-3 min-h-11 rounded-lg bg-blue-600 font-bold text-white active:bg-blue-700 disabled:opacity-50"
        disabled={actionDisabled} onClick={onConfirm} onPointerDown={keepInputFocused} type="button">{actionLabel}</button>
    </div>
  </section>;

  const displayRow = (values: string[], rowIndex: number) => {
    const columns = symbols ? "grid-cols-10" :
      rowIndex === 1 ? "grid-cols-9 px-[5%]" : rowIndex === 2 ? "grid-cols-7 px-[15%]" : "grid-cols-10";
    return <div className={`grid ${columns} gap-1`} key={`row-${rowIndex}`}>
      {values.map(value => key(shifted && /^[a-z]$/.test(value) ? value.toUpperCase() : value))}
    </div>;
  };

  return <section aria-label={mode === "id" ? "직원 ID 미니 키보드" : "마스터 비밀번호 미니 키보드"}
    className="mx-auto w-full max-w-[640px] overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-lg sm:p-3.5"
    data-pos-touch-keyboard>
    <div className="mx-auto min-w-[560px] space-y-1.5">
      <div className="grid grid-cols-10 gap-1">
        {numberRow.map(value => key(value))}
      </div>
      {(symbols ? symbolRows.slice(0, 3) : qwertyRows.slice(0, 2)).map(displayRow)}
      {!symbols && <div className="grid grid-cols-9 gap-1">
        <button className={`${keyClass} text-xs`} onClick={() => setSymbols(true)}
          onPointerDown={keepInputFocused} type="button">특수문자</button>
        {qwertyRows[2].map(value => key(shifted ? value.toUpperCase() : value))}
        <button className={`${keyClass} text-xs`} onClick={onClear}
          onPointerDown={keepInputFocused} type="button">Clear</button>
      </div>}
      <div className="grid grid-cols-10 gap-1">
        <button className={`${keyClass} col-span-2 min-h-10 text-xs`} onClick={() => symbols ? setSymbols(false) : setShifted(value => !value)}
          onPointerDown={keepInputFocused} type="button">{symbols ? "ABC" : shifted ? "소문자" : "대문자"}</button>
        <button aria-label="백스페이스" className={`${keyClass} col-span-2`} onClick={onBackspace}
          onPointerDown={keepInputFocused} type="button">⌫</button>
        <button className={`${keyClass} col-span-3 min-h-10 text-xs`} onClick={() => onText(" ")}
          onPointerDown={keepInputFocused} type="button">Space</button>
        <button className={`${keyClass} col-span-1 min-h-10 text-xs`} onClick={onClose}
          onPointerDown={keepInputFocused} type="button">닫기</button>
        <button className="col-span-2 min-h-10 rounded-lg bg-blue-600 px-1 text-xs font-bold text-white active:bg-blue-700 disabled:opacity-50"
          disabled={actionDisabled} onClick={onConfirm} onPointerDown={keepInputFocused} type="button">{actionLabel}</button>
      </div>
    </div>
  </section>;
}
