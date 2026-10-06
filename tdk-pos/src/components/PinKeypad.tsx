"use client";

type PinKeypadProps = {
  digitDisabled: boolean;
  actionDisabled: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
};

const digits = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

export default function PinKeypad({ digitDisabled, actionDisabled, onDigit, onBackspace, onClear }: PinKeypadProps) {
  return <div className="mt-3 grid min-h-0 flex-1 grid-cols-3 grid-rows-4 gap-1.5">
    {digits.map(digit => (
      <button className="min-h-10 rounded-lg bg-slate-100 text-base font-bold text-slate-800 transition active:scale-[0.98] disabled:opacity-40" disabled={digitDisabled} key={digit} onClick={() => onDigit(digit)} type="button">
        {digit}
      </button>
    ))}
    <button className="min-h-10 rounded-lg bg-slate-100 text-base font-bold text-slate-700 transition active:scale-[0.98] disabled:opacity-40" disabled={actionDisabled} onClick={onBackspace} type="button">BS</button>
    <button className="min-h-10 rounded-lg bg-slate-100 text-base font-bold text-slate-800 transition active:scale-[0.98] disabled:opacity-40" disabled={digitDisabled} onClick={() => onDigit("0")} type="button">0</button>
    <button className="min-h-10 rounded-lg bg-slate-100 text-base font-bold text-slate-700 transition active:scale-[0.98] disabled:opacity-40" disabled={actionDisabled} onClick={onClear} type="button">C</button>
  </div>;
}
