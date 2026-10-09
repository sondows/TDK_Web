"use client";

const defaultKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "C"];

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
  inputDivider?: boolean;
  inputEdgeToEdge?: boolean;
  scale?: number;
};

export default function NumericInputKeypad({ value, onKey, disabled = false, disabledKeys = [], keys = defaultKeys, inputLabel = "입력", inputOffset = 2, inputAlign = "right", smallBackspace = false, className = "", inputHeight = 60, inputDivider = true, inputEdgeToEdge = false, scale = 1 }: NumericInputKeypadProps) {
  const scaled = scale !== 1;
  const containerPadding = 8 * scale;
  return <div className={`flex min-h-0 max-w-full flex-col self-center overflow-hidden border border-slate-300 ${scaled ? "flex-none rounded-[10px]" : "w-[337px] flex-1 rounded-xl p-2"} ${className}`} style={scaled ? { width: `${337 * scale}px`, padding: inputEdgeToEdge ? 0 : `${containerPadding}px` } : inputEdgeToEdge ? { padding: 0 } : undefined}>
    <div className={`grid shrink-0 grid-cols-3 items-center ${inputEdgeToEdge ? "" : "rounded-t-lg"} ${scaled ? "" : "gap-x-1"} ${inputDivider ? "border-b border-slate-300" : ""} bg-slate-50 text-slate-900`} style={{ height: inputHeight * scale + (inputEdgeToEdge ? containerPadding : 0), ...(scaled ? { columnGap: 4 * scale } : {}), ...(inputEdgeToEdge ? { paddingTop: containerPadding, paddingLeft: containerPadding, paddingRight: containerPadding } : {}) }}>
      <div className="col-start-3 flex justify-center">
        <div className={`relative font-bold ${scaled ? "" : "text-3xl"} ${inputAlign === "center" ? "w-full" : ""}`} style={scaled ? { fontSize: 30 * scale } : undefined}>
          <span aria-hidden="true" className="invisible">9</span>
          <div className={`absolute flex -translate-y-1/2 flex-col whitespace-nowrap ${inputAlign === "center" ? "left-1/2 -translate-x-1/2 items-center text-center" : "right-0 items-end"}`} style={{ top: `calc(50% + ${inputOffset}px)` }}>
            {inputLabel && <span className={`${scaled ? "" : "text-xs"} font-medium leading-3 text-slate-500`} style={scaled ? { fontSize: 12 * scale } : undefined}>{inputLabel}</span>}
            <b className="font-extrabold" style={scaled ? { fontSize: 36 * scale } : { fontSize: "2.25rem" }}>{value}</b>
          </div>
        </div>
      </div>
    </div>
    <div className={`grid min-h-0 flex-1 grid-cols-3 grid-rows-4 ${scaled ? "" : "mt-1 translate-y-[2px] gap-x-1 gap-y-0.5"}`} style={{ ...(scaled ? { marginTop: 4 * scale, transform: `translateY(${2 * scale}px)`, columnGap: 4 * scale, rowGap: 2 * scale } : {}), ...(inputEdgeToEdge ? { paddingLeft: containerPadding, paddingRight: containerPadding, paddingBottom: containerPadding } : {}) }}>
      {keys.map((key) => (
        <button
          className={`font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 ${scaled ? "" : key === "BS" && smallBackspace ? "text-[28px]" : key === "C" || key === "BS" ? "text-[30px]" : key === "000" ? "text-2xl" : "text-3xl"}`}
          disabled={disabled || disabledKeys.includes(key)}
          key={key}
          onClick={() => onKey(key)}
          style={scaled ? { borderRadius: 8 * scale, fontSize: (key === "000" ? 24 : 30) * scale } : undefined}
          type="button"
        >
          {key}
        </button>
      ))}
    </div>
  </div>;
}
