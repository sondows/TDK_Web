"use client";

import { formatSessionElapsed } from "@/lib/session-time";
import type { SelectedCustomer } from "./CustomerSelectDialog";

type TableInfo = {
  tableNo: string;
  sessionId: number | null;
  openedAt: string | null;
  personCount: number | null;
  babyCount: number | null;
};

const formatPeople = (adult: number, child: number) =>
  [adult > 0 ? `성인${adult}` : "", child > 0 ? `아동${child}` : ""].filter(Boolean).join("+");

const formatTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

export default function OrderTableInfoHeader({ selected, selectedCustomer, partyTableNos, partyTotals, now, onSelectCustomer }: {
  selected: TableInfo | null;
  selectedCustomer: SelectedCustomer | null;
  partyTableNos: string[];
  partyTotals: { adult: number; baby: number } | null;
  now: number;
  onSelectCustomer: () => void;
}) {
  if (!selected) return null;
  const selectedPeople = formatPeople(selected.personCount ?? 0, selected.babyCount ?? 0);
  const partyPeople = partyTotals ? formatPeople(partyTotals.adult, partyTotals.baby) : "";

  return (
    <div className="mt-3 flex items-start gap-3 border-b border-slate-200 pb-2">
      <b className="shrink-0 text-[40px] leading-none">{selected.tableNo}</b>
      <div className="min-w-0 flex-1">
        {selected.sessionId && (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <p className="min-w-0 truncate text-[11px] text-slate-500">
                {selected.openedAt
                  ? `${formatSessionElapsed(selected.openedAt, now)} (${formatTime(selected.openedAt)})`
                  : "-"}
              </p>
              <button aria-label={selectedCustomer ? `${selectedCustomer.name} 고객 변경` : "고객 선택"} className="ml-auto h-5 max-w-[45%] shrink-0 truncate rounded-md border border-slate-300 bg-white px-2 text-center text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={onSelectCustomer} title={selectedCustomer?.name ?? "고객"} type="button">{selectedCustomer?.name ?? "고객"}</button>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-3">
              <p className="min-w-0 truncate text-xs text-slate-500">{partyTableNos.map((no) => `+${no}T`).join(" ")}</p>
              <p className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-slate-50 px-2 text-xs">
                {selectedPeople && <span className="font-semibold text-slate-800">{selectedPeople}</span>}
                {partyTableNos.length > 0 && partyPeople && <span className="text-slate-500">{`(=${partyPeople})`}</span>}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
