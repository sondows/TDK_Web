"use client";

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
  const keyClassName = `flex items-center justify-center ${largeKeys ? "min-h-[54px] text-lg" : "min-h-10 text-base"} rounded-lg bg-slate-100 font-bold text-slate-800 transition active:scale-[0.98] disabled:opacity-40`;
  return <div className="mt-3 grid min-h-0 flex-1 grid-cols-3 grid-rows-4 gap-1.5">
    {digits.map(digit => (
      <button className={keyClassName} disabled={digitDisabled} key={digit} onClick={() => onDigit(digit)} type="button">
        {digit}
      </button>
    ))}
    <button className={`${keyClassName} text-slate-700`} disabled={actionDisabled} onClick={onBackspace} type="button">BS</button>
    <button className={keyClassName} disabled={digitDisabled} onClick={() => onDigit("0")} type="button">0</button>
    <button className={`${keyClassName} text-slate-700`} disabled={actionDisabled} onClick={onClear} type="button">C</button>
  </div>;
}
