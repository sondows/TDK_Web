"use client";

type PinKeypadProps = {
  digitDisabled: boolean;
  actionDisabled: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
};

const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function PinKeypad({ digitDisabled, actionDisabled, onDigit, onBackspace, onClear }: PinKeypadProps) {
  return <div className="mt-4 grid min-h-0 flex-1 grid-cols-3 grid-rows-4 gap-x-1 gap-y-3">
    {digits.map(digit => (
      <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={digitDisabled} key={digit} onClick={() => onDigit(digit)} type="button">
        {digit}
      </button>
    ))}
    <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={actionDisabled} onClick={onBackspace} type="button">BS</button>
    <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={digitDisabled} onClick={() => onDigit("0")} type="button">0</button>
    <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={actionDisabled} onClick={onClear} type="button">C</button>
  </div>;
}
