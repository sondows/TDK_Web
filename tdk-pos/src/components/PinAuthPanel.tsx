"use client";

import type { ReactNode } from "react";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";

type Person = { staffId: number; staffCode: string; name: string };

type PinAuthPanelProps<T extends Person> = {
  label: string;
  people: T[];
  selectedCode?: string | null;
  selectionDisabled: boolean;
  onSelect: (person: T) => void;
  pinInput: ReactNode;
  keypad: ReactNode;
  emptyMessage?: string;
  footer?: ReactNode;
  scrollablePeople?: boolean;
};

const sectionLabelStyle = "text-xs font-semibold leading-none text-slate-600";

export default function PinAuthPanel<T extends Person>({ label, people, selectedCode, selectionDisabled, onSelect, pinInput, keypad, emptyMessage, footer, scrollablePeople = false }: PinAuthPanelProps<T>) {
  const { ref, hints, handlers } = useHorizontalScroll(scrollablePeople, people.map(person => person.staffCode).join("\0"));
  return <div className="flex min-h-0 flex-1 flex-col">
    <section className="shrink-0 px-4 py-2 min-[340px]:px-[26px]">
      <h2 className={sectionLabelStyle}>{label}</h2>
      <div className={scrollablePeople ? "relative min-w-0" : "min-w-0"}>
      <div
        className="horizontal-select-scroll mt-1 flex min-w-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain pr-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-x]"
        {...(scrollablePeople ? { ...handlers, ref } : {})}
      >
        {people.map(person => (
          <button
            className={`h-14 shrink-0 justify-self-center rounded-xl border-2 px-4 text-lg font-bold transition active:scale-[0.98] ${scrollablePeople ? "w-[calc((100%_-_0.5rem)/2)] min-w-0" : "w-[120px] min-w-[120px]"} ${selectedCode === person.staffCode ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}
            disabled={selectionDisabled}
            key={person.staffId}
            onClick={() => onSelect(person)}
            type="button"
          >
            {person.name}
          </button>
        ))}
      </div>
      {scrollablePeople && hints.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-[-14px] flex w-[14px] items-center justify-center text-[32px] leading-none text-slate-500">⋮</span>}
      {scrollablePeople && hints.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[-14px] flex w-[14px] items-center justify-center text-[32px] leading-none text-slate-500">⋮</span>}
      </div>
      {!people.length && emptyMessage && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-center text-slate-500">{emptyMessage}</p>}
    </section>
    <section className="flex min-h-0 flex-1 flex-col border-t border-slate-200 px-4 pb-7 pt-2 min-[340px]:px-[26px]">
      <span className={sectionLabelStyle}>PIN</span>
      <div className="mt-1">{pinInput}</div>
      {keypad}
      {footer}
    </section>
  </div>;
}
