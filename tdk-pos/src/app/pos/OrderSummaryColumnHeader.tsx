export default function OrderSummaryColumnHeader({ className = "" }: { className?: string }) {
  return <div className={`${className} grid grid-cols-[1fr_52px_76px_58px] border-b border-slate-200 pb-2 text-[11px] font-bold text-slate-500`}>
    <span>메뉴명</span>
    <span className="text-right">단가</span>
    <span className="text-center">수량</span>
    <span className="text-right">금액</span>
  </div>;
}
