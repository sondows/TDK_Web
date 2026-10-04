"use client";

const defaultKeys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "000", "0", "C"];

type NumericInputKeypadProps = {
  value: string;
  onKey: (key: string) => void;
  disabled?: boolean;
  keys?: string[];
  inputLabel?: string;
};

export default function NumericInputKeypad({ value, onKey, disabled = false, keys = defaultKeys, inputLabel = "입력" }: NumericInputKeypadProps) {
  return <div className="flex min-h-0 w-[337px] max-w-full flex-1 flex-col self-center overflow-hidden rounded-xl border border-slate-300 p-2">
    <div className="grid h-[60px] shrink-0 grid-cols-3 items-center gap-x-1 border-b border-slate-300">
      <div className="col-start-3 flex justify-center">
        <div className="relative text-3xl font-bold">
          <span aria-hidden="true" className="invisible">9</span>
          <div className="absolute right-0 top-[calc(50%+2px)] flex -translate-y-1/2 flex-col items-end whitespace-nowrap">
            <span className="text-xs font-medium leading-3 text-slate-500">{inputLabel}</span>
            <b className="text-4xl font-extrabold">{value}</b>
          </div>
        </div>
      </div>
    </div>
    <div className="mt-1 grid min-h-0 flex-1 translate-y-[2px] grid-cols-3 grid-rows-4 gap-x-1 gap-y-0.5">
      {keys.map((key) => (
        <button
          className={`min-h-[70px] font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 ${key === "C" || key === "BS" ? "text-[30px]" : key === "000" ? "text-2xl" : "text-3xl"}`}
          disabled={disabled}
          key={key}
          onClick={() => onKey(key)}
          type="button"
        >
          {key}
        </button>
      ))}
    </div>
  </div>;
}
