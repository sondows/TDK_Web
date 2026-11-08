export default function OrderSummaryColumnHeader({ className = "", cancellationMode = false }: { className?: string; cancellationMode?: boolean }) {
  const columns = cancellationMode
    ? "grid-cols-[minmax(0,1fr)_minmax(44px,60px)_minmax(120px,124px)_minmax(52px,68px)] gap-1.5"
    : "grid-cols-[1fr_52px_76px_58px]";
  return <div className={`${className} grid ${columns} border-b border-slate-200 pb-2 text-[11px] font-bold text-slate-500`}>
    <span>메뉴명</span>
    <span className="text-right">단가</span>
    <span className="text-center">수량</span>
    <span className="text-right">금액</span>
  </div>;
}
