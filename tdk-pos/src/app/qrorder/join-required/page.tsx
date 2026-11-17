import QrDevTestBadge from "../QrDevTestBadge";

export const dynamic = "force-dynamic";

export default function QrOrderJoinRequiredPage() {
  return <main className="mx-auto min-h-svh max-w-lg bg-slate-50 px-6 text-center text-slate-900">
    <QrDevTestBadge />
    <section className="pt-28">
      <h1 className="text-xl font-black">TDKON ORDER</h1>
      <h2 className="mt-8 text-lg font-extrabold">이용 중인 테이블입니다</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">기존 주문내역은 테이블 QR을 새로 스캔한 고객에게 공개되지 않습니다.<br />테이블에 먼저 참여한 분에게 일행 초대 QR을 요청해 스캔해 주세요.</p>
    </section>
  </main>;
}
