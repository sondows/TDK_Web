"use client";

import { PIN_KEYPAD_GRID_CLASS_NAME, PIN_KEYPAD_LARGE_BUTTON_CLASS_NAME } from "./pin-keypad-style";

type PinKeypadProps = {
  digitDisabled: boolean;
  actionDisabled: boolean;
  largeKeys?: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
};

const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function PinKeypad({ digitDisabled, actionDisabled, largeKeys = false, onDigit, onBackspace, onClear }: PinKeypadProps) {
  const keyClassName = `${largeKeys ? PIN_KEYPAD_LARGE_BUTTON_CLASS_NAME : "flex min-h-10 items-center justify-center rounded-lg text-base"} bg-slate-100 font-bold text-slate-800 transition active:scale-[0.98] disabled:opacity-40`;
  return <div className={`mt-3 ${PIN_KEYPAD_GRID_CLASS_NAME}`}>
    {digits.map(digit => (
      <button className={keyClassName} disabled={digitDisabled} key={digit} onClick={() => onDigit(digit)} type="button">
        {digit}
      </button>
    ))}
    <button aria-label="마지막 숫자 삭제" className={`${keyClassName} text-slate-700`} disabled={actionDisabled} onClick={onBackspace} type="button">⌫</button>
    <button className={keyClassName} disabled={digitDisabled} onClick={() => onDigit("0")} type="button">0</button>
    <button className={`${keyClassName} text-slate-700`} disabled={actionDisabled} onClick={onClear} type="button">C</button>
  </div>;
}
