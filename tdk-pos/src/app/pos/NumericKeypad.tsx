"use client";

const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "C"];

export default function NumericKeypad({ disabled, onKey }: { disabled: boolean; onKey: (key: string) => void }) {
  return <div className="h-full w-[337px] max-w-full overflow-hidden rounded-xl border border-slate-300 p-2">
    <div className="grid h-full min-h-0 grid-cols-3 grid-rows-4 gap-1">
      {keys.map(key => <button
        className={`min-h-[70px] font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 ${key === "C" ? "text-[30px]" : key === "000" ? "text-2xl" : "text-3xl"}`}
        disabled={disabled} key={key} onClick={() => onKey(key)} type="button">{key}</button>)}
    </div>
  </div>;
}
