"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";
import QrStoreTitle from "@/app/qr/QrStoreTitle";
import QrTitleCarousel from "@/app/qr/QrTitleCarousel";
import type { QrPublicTitleSettings } from "@/lib/qr-title-model";
import type { QrPublicNotice } from "@/lib/qr-notice-model";
import QrOrderTitleBar from "./QrOrderTitleBar";

type OrderItem = { qrOrderId: number; qrOrderItemId: number; menuId: number; itemName: string; qty: number; unitPrice: string; totalAmount: string;
  options: Array<{ optionName: string; qty: number; totalAmount: string }>; kdsKind: string; stage: string | null; timerEndsAtMs: number | null };
type QrOrder = { qrOrderId: number; status: string; totalAmount: string; orderedAt: string; acceptedOrderId: number | null; acceptedAt: string | null; note: string | null };
type Payload = { success?: boolean; tableNo?: string; serverNow?: number; canViewOrders?: boolean; needsJoin?: boolean; orders?: QrOrder[]; items?: OrderItem[]; message?: string };

const won = (amount: string | number) => `${new Intl.NumberFormat("ko-KR").format(Math.round(Number(amount)))}원`;
const dateTime = (value: string) => new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

export default function QrOrderHistory({ titleData, notices = [] }: { titleData: QrPublicTitleSettings; notices?: QrPublicNotice[] }) {
  const router = useRouter();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const [inviteQr, setInviteQr] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/qr/table-orders", { cache: "no-store", credentials: "same-origin" });
    const data = await response.json() as Payload;
    if (!response.ok || !data.success) throw new Error(data.message ?? "테이블 QR 인증이 필요합니다. 테이블 스티커를 스캔해 주세요.");
    setPayload(data);
    setServerOffset((data.serverNow ?? Date.now()) - Date.now());
    setError("");
    if (data.needsJoin && !data.orders?.some(order => order.status === "PENDING")) router.replace("/qrorder/join-required");
    else if (data.orders?.length === 0) router.replace("/qrorder/order");
  }, [router]);

  useEffect(() => {
    let mounted = true;
    const load = () => void refresh().catch(reason => { if (mounted) setError(reason instanceof Error ? reason.message : "주문내역을 불러오지 못했습니다."); });
    const poll = window.setInterval(load, 5000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    load();
    return () => { mounted = false; window.clearInterval(poll); window.clearInterval(tick); };
  }, [refresh]);

  const total = useMemo(() => (payload?.orders ?? []).filter(order => order.status === "PENDING" || order.status === "ACCEPTED")
    .reduce((sum, order) => sum + Number(order.totalAmount), 0), [payload?.orders]);
  const makeInvite = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/qr/order-invites", { method: "POST", credentials: "same-origin" });
      const result = await response.json() as { success?: boolean; url?: string; message?: string };
      if (!response.ok || !result.success || !result.url) throw new Error(result.message ?? "초대 링크를 만들지 못했습니다.");
      setInvite(result.url);
      setInviteQr(await QRCode.toDataURL(result.url, { width: 240, margin: 1, errorCorrectionLevel: "M" }));
      await navigator.clipboard?.writeText(result.url).catch(() => undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "초대 링크를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };

  const titlePhotoLayout = titleData.photos.length > 0 ? { paddingTop: "calc(75vw - clamp(32px, 8vw, 40px))" } : undefined;
  if (error && !payload) return <main className="mx-auto min-h-svh max-w-lg bg-slate-50 px-4 pb-28 text-center text-slate-900" style={titlePhotoLayout}>
    {titleData.photos.length > 0 && <QrTitleCarousel fixedHero photos={titleData.photos} />}
    <QrOrderTitleBar fixedImageOverlay title="주문 확인" />
    <QrStoreTitle fixedHero={titleData.photos.length > 0} notices={notices} settings={titleData} />
    <p className="mt-5 text-slate-600">{error}</p>
  </main>;
  const latestOrder = payload?.orders?.at(-1);
  const orderTitle = payload?.orders?.some(order => order.status === "PENDING") ? "주문 대기"
    : latestOrder?.status === "ACCEPTED" ? "주문 완료" : "주문 확인";
  return <main className="mx-auto min-h-svh max-w-lg bg-slate-50 px-4 pb-28 text-slate-900" style={titlePhotoLayout}>
    {titleData.photos.length > 0 && <QrTitleCarousel fixedHero photos={titleData.photos} />}
    <QrOrderTitleBar fixedImageOverlay tableNo={payload?.tableNo ?? null} title={orderTitle} />
    <QrStoreTitle fixedHero={titleData.photos.length > 0} notices={notices} settings={titleData} />
    <div className="flex items-end justify-between"><h2 className="text-xl font-extrabold">주문내역</h2></div>
    <div className="mt-4 flex justify-between border-b border-slate-200 pb-4 text-sm"><span className="font-semibold text-slate-500">주문금액</span><strong className="text-lg">{won(total)}</strong></div>
    {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
    <div className="mt-4 space-y-3">{(payload?.orders ?? []).map((order, index) => <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={order.qrOrderId}>
      <div className="flex justify-between"><h3 className="font-extrabold">{index + 1}차 주문</h3><span className="text-sm text-slate-500">{dateTime(order.orderedAt)}</span></div>
      <p className={`mt-1 text-sm font-bold ${order.status === "REJECTED" ? "text-red-600" : order.status === "PENDING" ? "text-amber-600" : "text-blue-700"}`}>{order.status === "PENDING" ? "직원 확인 대기" : order.status === "ACCEPTED" ? "주문 접수" : order.status === "REJECTED" ? "직원 확인 필요" : "주문 취소"}</p>
      {order.status === "REJECTED" && order.note && <p className="mt-1 text-xs leading-5 text-red-600">{order.note}</p>}
      <ul className="mt-3 divide-y divide-slate-100">{(payload?.items ?? []).filter(item => item.qrOrderId === order.qrOrderId).map(item => <li className="py-3" key={item.qrOrderItemId}>
        <div className="flex justify-between gap-3"><span className="font-semibold">{item.itemName} {item.qty > 1 ? item.qty : ""}</span><span className="shrink-0 tabular-nums">{won(item.totalAmount)}</span></div>
        {item.options.length > 0 && <p className="mt-1 text-xs text-slate-500">{item.options.map(option => `${option.optionName}${option.qty > 1 ? ` ×${option.qty}` : ""}`).join(" · ")}</p>}
        {item.stage && <div className="mt-3">
          <div className="flex justify-between text-[11px] font-semibold text-slate-500"><span>조리대기</span><span>조리중</span>{item.kdsKind === "POT" && <span>주방조리완료</span>}{item.kdsKind === "POT" && <span>매장끓이기</span>}<span>조리완료</span></div>
          <div className="mt-1 flex gap-1">{Array.from({ length: item.kdsKind === "POT" ? 5 : 3 }, (_, step) => {
            const activeIndex = item.stage === "WAITING" ? 0 : item.stage === "COOKING" ? 1 : item.stage === "DONE" ? (item.kdsKind === "POT" && item.timerEndsAtMs && now + serverOffset < item.timerEndsAtMs ? 3 : item.kdsKind === "POT" ? 4 : 2) : 0;
            return <span className={`h-1.5 flex-1 rounded-full ${step < activeIndex ? "bg-blue-400" : step === activeIndex ? "bg-blue-700" : "bg-slate-200"}`} key={step} />;
          })}</div>
          {item.kdsKind === "POT" && item.stage === "DONE" && item.timerEndsAtMs && (now + serverOffset < item.timerEndsAtMs
            ? <p className="mt-2 text-sm font-bold text-blue-700">매장끓이기 · {Math.floor((item.timerEndsAtMs - (now + serverOffset)) / 60000)}:{String(Math.floor(((item.timerEndsAtMs - (now + serverOffset)) % 60000) / 1000)).padStart(2, "0")} 남음</p>
            : <p className="mt-2 text-sm font-bold text-blue-700">조리완료 · 먹어도 됩니다</p>)}</div>}
      </li>)}</ul>
      <div className="flex justify-end border-t border-slate-100 pt-3 font-extrabold">{won(order.totalAmount)}</div>
    </section>)}</div>
    {invite && <div className="mt-3 flex items-center gap-3 rounded-xl bg-blue-50 p-3"><Image alt="일행 초대 QR" className="size-24" height={96} src={inviteQr} unoptimized width={96} /><p className="min-w-0 break-all text-xs text-blue-800">초대 QR을 스캔하거나 링크를 사용하세요. 30분 동안 유효합니다.<br />{invite}</p></div>}
    {payload?.canViewOrders ? <div className="fixed inset-x-0 bottom-0 mx-auto flex max-w-lg gap-2 bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(15,23,42,.08)] backdrop-blur">
      <button className="min-h-12 flex-1 rounded-xl border border-blue-200 bg-white font-bold text-blue-700" disabled={busy} onClick={() => void makeInvite()} type="button">일행 초대</button>
      <button className="min-h-12 flex-[2] rounded-xl bg-blue-700 font-extrabold text-white" onClick={() => router.push("/qrorder/order")} type="button">+ 추가 주문하기</button>
    </div> : (payload?.orders ?? []).some(order => order.status === "PENDING") ? <div className="fixed inset-x-0 bottom-0 mx-auto max-w-lg bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-sm font-semibold text-amber-700 shadow-[0_-4px_16px_rgba(15,23,42,.08)] backdrop-blur">첫 주문 승인 후 테이블 이용이 시작됩니다.</div>
      : (payload?.orders ?? []).some(order => order.status === "REJECTED") ? <div className="fixed inset-x-0 bottom-0 mx-auto max-w-lg bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(15,23,42,.08)] backdrop-blur"><button className="min-h-12 w-full rounded-xl bg-blue-700 font-extrabold text-white" onClick={() => router.push("/qrorder/order")} type="button">다시 주문하기</button></div> : null}
  </main>;
}
