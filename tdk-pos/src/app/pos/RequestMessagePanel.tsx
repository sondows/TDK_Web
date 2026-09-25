export type PosRequestMessage = {
  id: string;
  type: "QR주문" | "손님호출" | "대기" | "주방";
  title: string;
  description?: string;
  timeLabel: string;
  actionLabel: string;
};

export default function RequestMessagePanel({ messages = [] }: { messages?: PosRequestMessage[] }) {
  return <section className="pos-message-area box-border flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
    <header className="pos-message-header flex h-9 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
      <h2 className="text-sm font-bold text-slate-700">🔔 요청 / 메시지</h2>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{messages.length}</span>
    </header>
    <div className="pos-message-list min-h-0 flex-1 overflow-y-auto">
      {messages.length === 0 ? <p className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">현재 새로운 요청이 없습니다</p> : <ul className="divide-y divide-slate-200 bg-white">{messages.map(message => <li className="flex items-center gap-2 px-3 py-2.5" key={message.id}>
        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-1 text-[10px] font-bold text-slate-600">{message.type}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{message.title}</p>{message.description && <p className="truncate text-[11px] text-slate-500">{message.description}</p>}</div>
        <span className="shrink-0 text-[10px] text-slate-400">{message.timeLabel}</span>
        <button className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 active:scale-95" type="button">{message.actionLabel}</button>
      </li>)}</ul>}
    </div>
  </section>;
}
