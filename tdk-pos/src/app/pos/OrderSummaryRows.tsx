import { formatMoney } from "@/lib/format-money";
import type { SummaryRow } from "@/lib/pos-order-summary-rows";
import MeasuredMenuLabel from "./MeasuredMenuLabel";

export default function OrderSummaryRows({ items, onOptionClick, canEditOption }: {
  items: SummaryRow[]; onOptionClick?: (item: SummaryRow) => void; canEditOption?: (item: SummaryRow) => boolean;
}) {
  const renderRow = (item: SummaryRow, component = false) => (
    <div className={`grid grid-cols-[minmax(0,1fr)_52px_76px_58px] gap-1 text-sm ${component ? "pl-3 text-slate-600" : ""}`} key={item.rowKey}>
      <MeasuredMenuLabel
        className="block min-w-0 overflow-hidden whitespace-nowrap font-medium"
        name={item.name}
        optionLabel={item.optionLabel}
        onOptionClick={onOptionClick && canEditOption?.(item) ? () => onOptionClick(item) : undefined}
        optionClassName={`ml-1 text-[10px] font-normal ${onOptionClick && canEditOption?.(item) ? "text-blue-700 underline-offset-2 hover:underline" : "text-slate-500"}`}
        prefix={component ? "└" : undefined}
        tail={item.itemType === "SERVICE" ? "무료제공" : undefined}
        title={`${item.name}${item.optionLabel ? ` (${item.optionLabel})` : ""}`}
      />
      <span className="text-right text-slate-500">{new Intl.NumberFormat("ko-KR").format(item.itemType === "SERVICE" ? 0 : item.unitPrice)}</span>
      <span className="text-center text-slate-500">× {item.qty}</span>
      <b className="text-right">{formatMoney(item.total)}</b>
    </div>
  );

  return (
    <div className="pos-display-copy flex flex-col gap-y-[7px]">
      {items.map(item => (
        <div className="space-y-1" key={item.rowKey}>
          {renderRow(item)}
          {item.components.map(component => renderRow(component, true))}
        </div>
      ))}
    </div>
  );
}
