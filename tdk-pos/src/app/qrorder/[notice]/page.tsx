import Link from "next/link";

const messages: Record<string, string> = {
  unavailable: "사용할 수 없는 QR입니다. 직원에게 확인해 주세요.",
  "service-unavailable": "QR 주문 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. 문제가 계속되면 직원을 불러 주세요.",
  "join-required": "이미 주문 세션이 시작되었습니다. 먼저 접속한 일행에게 초대 링크를 요청해 주세요.",
  "invite-invalid": "초대 링크가 만료되었거나 사용할 수 없습니다.",
  "invite-full": "테이블 참여 인원 한도에 도달했습니다.",
};

export default async function QrOrderNoticePage({ params }: { params: Promise<{ notice: string }> }) {
  const notice = (await params).notice;
  return <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center bg-slate-50 p-6 text-center text-slate-900"><h1 className="text-xl font-black">TDKON ORDER</h1><p className="mt-4 text-slate-600">{messages[notice] ?? "요청한 QR 화면을 찾을 수 없습니다."}</p><Link className="mt-6 rounded-xl bg-blue-700 px-5 py-3 font-bold text-white" href="/qr">메뉴 보기</Link></main>;
}
