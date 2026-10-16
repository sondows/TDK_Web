import { formatMoney } from "@/lib/format-money";
import type { SummaryRow } from "@/lib/pos-order-summary-rows";

export default function OrderSummaryRows({ items }: { items: SummaryRow[] }) {
  const renderRow = (item: SummaryRow, component = false) => (
    <div className={`grid grid-cols-[minmax(0,1fr)_52px_76px_58px] gap-1 text-sm ${component ? "pl-3 text-slate-600" : ""}`} key={item.rowKey}>
      <span className="min-w-0 truncate font-medium" title={item.name}>
        {component && <span aria-hidden="true" className="mr-1 text-slate-400">└</span>}
        {item.name}
        {item.optionLabel && <small className="ml-1 text-[10px] font-normal text-slate-500">({item.optionLabel})</small>}
        {item.itemType === "SERVICE" && <small className="ml-1 font-semibold text-blue-700">무료제공</small>}
      </span>
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
