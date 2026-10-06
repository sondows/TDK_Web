"use client";

const defaultKeys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "000", "0", "C"];

type NumericInputKeypadProps = {
  value: string;
  onKey: (key: string) => void;
  disabled?: boolean;
  disabledKeys?: string[];
  keys?: string[];
  inputLabel?: string;
  inputOffset?: number;
  inputAlign?: "right" | "center";
  smallBackspace?: boolean;
  className?: string;
  inputHeight?: number;
};

export default function NumericInputKeypad({ value, onKey, disabled = false, disabledKeys = [], keys = defaultKeys, inputLabel = "입력", inputOffset = 2, inputAlign = "right", smallBackspace = false, className = "", inputHeight = 60 }: NumericInputKeypadProps) {
  return <div className={`flex min-h-0 w-[337px] max-w-full flex-1 flex-col self-center overflow-hidden rounded-xl border border-slate-300 p-2 ${className}`}>
    <div className="grid shrink-0 grid-cols-3 items-center gap-x-1 border-b border-slate-300" style={{ height: inputHeight }}>
      <div className="col-start-3 flex justify-center">
        <div className={`relative text-3xl font-bold ${inputAlign === "center" ? "w-full" : ""}`}>
          <span aria-hidden="true" className="invisible">9</span>
          <div className={`absolute flex -translate-y-1/2 flex-col whitespace-nowrap ${inputAlign === "center" ? "left-1/2 -translate-x-1/2 items-center text-center" : "right-0 items-end"}`} style={{ top: `calc(50% + ${inputOffset}px)` }}>
            {inputLabel && <span className="text-xs font-medium leading-3 text-slate-500">{inputLabel}</span>}
            <b className="text-4xl font-extrabold">{value}</b>
          </div>
        </div>
      </div>
    </div>
    <div className="mt-1 grid min-h-0 flex-1 translate-y-[2px] grid-cols-3 grid-rows-4 gap-x-1 gap-y-0.5">
      {keys.map((key) => (
        <button
          className={`font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 ${key === "BS" && smallBackspace ? "text-[28px]" : key === "C" || key === "BS" ? "text-[30px]" : key === "000" ? "text-2xl" : "text-3xl"}`}
          disabled={disabled || disabledKeys.includes(key)}
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
