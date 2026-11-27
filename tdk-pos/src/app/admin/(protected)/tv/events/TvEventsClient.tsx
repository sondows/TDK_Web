"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { parseJsonResponse } from "@/lib/api-response";
import { getTvEventAnchorStyle, getTvEventTextStyle } from "@/lib/tdktv-event-rendering";

type Screen = { screenId: number; code: string; name: string; fitMode: "CONTAIN" | "COVER" };
type TvImage = { imageId: number; screenId: number; originalName: string; isActive: number; url: string };
type EventItem = { eventId: number; imageId: number; eventName: string; message: string; positionX: number; positionY: number; widthPercent: number;
  fontSize: number; fontWeight: number; textColor: string; textAlign: "LEFT" | "CENTER" | "RIGHT"; lineHeight: number;
  backgroundMode: "NONE" | "SOLID" | "TRANSLUCENT"; backgroundColor: string; backgroundOpacity: number; borderEnabled: number;
  borderColor: string; borderWidth: number; borderRadius: number; animation: "NONE" | "FADE" | "PULSE" | "SLIDE" | "GLOW"; isActive: number };
type Draft = Omit<EventItem, "eventId" | "imageId" | "borderEnabled" | "isActive"> & { borderEnabled: boolean; isActive: boolean };
const api = "/api/admin/tdktv/events";
const field = "min-h-10 rounded border border-slate-300 bg-white px-3 text-sm";
const button = "min-h-10 rounded border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-40";
const primary = "min-h-10 rounded bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-40";
const initial: Draft = { eventName: "이벤트 문구", message: "메시지를 입력하세요", positionX: 5000, positionY: 5000, widthPercent: 3500,
  fontSize: 48, fontWeight: 700, textColor: "#FFFFFF", textAlign: "CENTER", lineHeight: 120, backgroundMode: "NONE",
  backgroundColor: "#145B46", backgroundOpacity: 85, borderEnabled: false, borderColor: "#FFFFFF", borderWidth: 2, borderRadius: 16,
  animation: "PULSE", isActive: true };
export default function TvEventsClient() {
  const [screens, setScreens] = useState<Screen[]>([]); const [images, setImages] = useState<TvImage[]>([]);
  const [screenId, setScreenId] = useState<number | null>(null); const [imageId, setImageId] = useState<number | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]); const [draft, setDraft] = useState<Draft>(initial); const [eventId, setEventId] = useState<number | null>(null);
  const [status, setStatus] = useState("불러오는 중입니다."); const [busy, setBusy] = useState(false); const previewRef = useRef<HTMLDivElement>(null);
  const menuScreens = useMemo(() => screens.filter(screen => /^DP[2-5]$/.test(screen.code)), [screens]);
  const menuImages = useMemo(() => images.filter(image => image.screenId === screenId), [images, screenId]);
  const selectedImage = menuImages.find(image => image.imageId === imageId) ?? menuImages[0];

  async function loadEvents(targetImageId: number): Promise<EventItem[]> {
    const response = await fetch(`${api}?imageId=${targetImageId}`, { cache: "no-store" }); const body = await parseJsonResponse<{ success: boolean; events: EventItem[]; message?: string }>(response, response.url, "TV image event list", "GET");
    if (!response.ok || !body.success) throw Error(body.message || "이벤트 목록을 불러오지 못했습니다.");
    return body.events;
  }
  useEffect(() => {
    let live = true;
    fetch("/api/admin/tdktv", { cache: "no-store" }).then(async response => { const body = await parseJsonResponse<{ success: boolean; screens: Screen[]; images: TvImage[]; message?: string }>(response, response.url, "TV screen and image list", "GET"); if (!body.success) throw Error(body.message || "TV 목록을 불러오지 못했습니다."); return body; })
      .then(body => { if (!live) return; const nextScreens = body.screens as Screen[]; const nextImages = body.images as TvImage[]; const allowed = nextScreens.filter(screen => /^DP[2-5]$/.test(screen.code));
        setScreens(nextScreens); setImages(nextImages); setScreenId(allowed[0]?.screenId ?? null); const first = nextImages.find((image: TvImage) => allowed.some(screen => screen.screenId === image.screenId)); setImageId(first?.imageId ?? null); setStatus(first ? "" : "DP2~DP5 메뉴판에 이미지가 등록되어 있지 않습니다."); })
      .catch(error => { if (live) setStatus(error instanceof Error ? error.message : "TV 목록을 불러오지 못했습니다."); });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (!imageId) return; let live = true; loadEvents(imageId).then(next => { if (live) { setEvents(next); setEventId(null); setDraft(initial); setStatus(""); } }).catch(error => { if (live) setStatus(error instanceof Error ? error.message : "이벤트를 불러오지 못했습니다."); }); return () => { live = false; }; }, [imageId]);

  function selectEvent(item: EventItem) { setEventId(item.eventId); const { borderEnabled, isActive, ...rest } = item; setDraft({ ...rest, borderEnabled: Boolean(borderEnabled), isActive: Boolean(isActive) }); }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(current => {
    const next = { ...current, [key]: value };
    const margin = key === "widthPercent" ? Number(value) / 2 : next.widthPercent / 2;
    next.positionX = Math.max(margin, Math.min(10000 - margin, next.positionX));
    return next;
  }); }
  function drag(event: PointerEvent<HTMLDivElement>) {
    if (!event.buttons || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect(); const x = Math.max(0, Math.min(10000, Math.round((event.clientX - rect.left) / rect.width * 10000)));
    const y = Math.max(0, Math.min(10000, Math.round((event.clientY - rect.top) / rect.height * 10000)));
    update("positionX", x); update("positionY", y);
  }
  async function save() {
    if (!imageId) return; setBusy(true);
    try { const response = await fetch(api, { method: eventId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, imageId, eventId }) }); const body = await parseJsonResponse<{ success: boolean; message?: string }>(response, response.url, "TV image event save", eventId ? "PATCH" : "POST"); if (!body.success) throw Error(body.message || "이벤트를 저장하지 못했습니다.");
      setEvents(await loadEvents(imageId)); setEventId(null); setDraft(initial); setStatus("저장했습니다. TV에는 다음 10초 설정 조회 때 반영됩니다."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "저장하지 못했습니다."); } finally { setBusy(false); }
  }
  async function remove(item: EventItem) {
    if (!window.confirm(`'${item.eventName}' 이벤트를 삭제할까요?`)) return; setBusy(true);
    try { const response = await fetch(api, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: item.eventId }) }); const body = await parseJsonResponse<{ success: boolean; message?: string }>(response, response.url, "TV image event delete", "DELETE"); if (!body.success) throw Error(body.message || "삭제하지 못했습니다."); setEvents(await loadEvents(item.imageId)); setStatus("이벤트를 삭제했습니다."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "삭제하지 못했습니다."); } finally { setBusy(false); }
  }
  const previewAnchorStyle = getTvEventAnchorStyle(draft, true);
  const previewTextStyle = getTvEventTextStyle(draft);

  return <main className="mx-auto w-full max-w-7xl p-5 text-slate-800 md:p-8">
    <h1 className="text-2xl font-bold">디지털 사이니지 · 이벤트 효과 관리</h1>
    <p className="mt-2 text-sm text-slate-600">DP2~DP5 메뉴판 이미지에 연결된 문구만 재생합니다. 이미지마다 최대 5개이며 HTML은 실행되지 않습니다.</p>
    <nav aria-label="디지털 사이니지" className="mt-5 flex flex-wrap gap-2">{[["TV 관리", "/tdkadm/tv"], ["이미지 관리", "/tdkadm/tv/images"], ["재생 설정", "/tdkadm/tv/playback"], ["안내문 관리", "/tdkadm/tv/notice"], ["이벤트 효과 관리", "/tdkadm/tv/events"]].map(([label, href]) => <a key={href} href={href} className={`${button} inline-flex items-center`}>{label}</a>)}</nav>
    {status && <p role="status" className="mt-4 rounded bg-blue-50 p-3 text-sm text-blue-900">{status}</p>}
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
      <section className="space-y-4 rounded-lg border bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">메뉴판<select className={`${field} mt-1 block w-full`} value={screenId ?? ""} onChange={event => { const id = Number(event.target.value); setScreenId(id); setEvents([]); setImageId(images.find(image => image.screenId === id)?.imageId ?? null); }}>
            {menuScreens.map(screen => <option key={screen.screenId} value={screen.screenId}>{screen.code} · {screen.name}</option>)}</select></label>
          <label className="text-sm font-semibold">연결할 이미지<select className={`${field} mt-1 block w-full`} value={selectedImage?.imageId ?? ""} onChange={event => setImageId(Number(event.target.value))}>
            {menuImages.map(image => <option key={image.imageId} value={image.imageId}>{image.originalName}{image.isActive ? " · 재생 중" : " · 비활성"}</option>)}</select></label>
        </div>
        {selectedImage && <div><p className="mb-2 text-sm font-semibold">{selectedImage.originalName} · 16:9 미리보기 (드래그하여 위치 변경)</p>
          <div ref={previewRef} className="relative aspect-video touch-none overflow-hidden rounded bg-slate-900 select-none" onPointerMove={drag}>
            <Image unoptimized fill src={selectedImage.url} alt="메뉴판 이미지 미리보기" className="pointer-events-none" style={{ objectFit: menuScreens.find(screen => screen.screenId === screenId)?.fitMode === "COVER" ? "cover" : "contain" }} sizes="80vw" />
            <div className="tdktv-event" style={previewAnchorStyle} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag(event); }}>
              <span style={previewTextStyle}>{draft.message || "이벤트 문구 미리보기"}</span>
            </div>
          </div><p className="mt-2 text-xs text-slate-500">위치 X { (draft.positionX / 100).toFixed(1) }% · Y { (draft.positionY / 100).toFixed(1) }% · FHD 화면 좌표 기준</p></div>}
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">이 이미지의 이벤트 ({events.length}/5)</h2><button className={button} disabled={!imageId || busy || events.length >= 5} onClick={() => { setEventId(null); setDraft(initial); }}>새 이벤트</button></div>
        <ul className="space-y-2">{events.map(item => <li key={item.eventId} className={`flex flex-wrap items-center gap-2 rounded border p-3 ${eventId === item.eventId ? "border-blue-500 bg-blue-50" : ""}`}>
          <button className="min-w-0 flex-1 text-left" onClick={() => selectEvent(item)}><span className="block font-semibold">{item.eventName} {item.isActive ? "· ON" : "· OFF"}</span><span className="block truncate text-sm text-slate-600">{item.message}</span></button>
          <button className={button} disabled={busy} onClick={() => void remove(item)}>삭제</button>
        </li>)}</ul>
      </section>
      <section className="grid content-start gap-3 rounded-lg border bg-white p-5 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-lg font-bold">이벤트 문구 설정</h2>
        <label className="text-sm font-semibold">이벤트 이름<input className={`${field} mt-1 block w-full`} maxLength={100} value={draft.eventName} onChange={event => update("eventName", event.target.value)} /></label>
        <label className="text-sm font-semibold">재생 상태<select className={`${field} mt-1 block w-full`} value={String(draft.isActive)} onChange={event => update("isActive", event.target.value === "true")}><option value="true">ON</option><option value="false">OFF</option></select></label>
        <label className="sm:col-span-2 text-sm font-semibold">표시 문구<textarea className={`${field} mt-1 min-h-24 w-full p-3`} maxLength={500} value={draft.message} onChange={event => update("message", event.target.value)} /></label>
        <label className="text-sm font-semibold">문구 폭 (%)<input className={`${field} mt-1 block w-full`} type="number" min={5} max={100} value={draft.widthPercent / 100} onChange={event => update("widthPercent", Math.min(10000, Math.max(500, Number(event.target.value) * 100)))} /></label>
        <label className="text-sm font-semibold">글씨 크기 (px)<input className={`${field} mt-1 block w-full`} type="number" min={16} max={160} value={draft.fontSize} onChange={event => update("fontSize", Number(event.target.value))} /></label>
        <label className="text-sm font-semibold">글씨 색상<input className={`${field} mt-1 block w-full p-1`} type="color" value={draft.textColor} onChange={event => update("textColor", event.target.value)} /></label>
        <label className="text-sm font-semibold">정렬<select className={`${field} mt-1 block w-full`} value={draft.textAlign} onChange={event => update("textAlign", event.target.value as Draft["textAlign"])}><option value="LEFT">왼쪽</option><option value="CENTER">가운데</option><option value="RIGHT">오른쪽</option></select></label>
        <label className="text-sm font-semibold">글씨 굵기<select className={`${field} mt-1 block w-full`} value={draft.fontWeight} onChange={event => update("fontWeight", Number(event.target.value))}>{[400,500,600,700,800].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm font-semibold">줄 간격 (%)<input className={`${field} mt-1 block w-full`} type="number" min={90} max={180} value={draft.lineHeight} onChange={event => update("lineHeight", Number(event.target.value))} /></label>
        <label className="text-sm font-semibold">애니메이션<select className={`${field} mt-1 block w-full`} value={draft.animation} onChange={event => update("animation", event.target.value as Draft["animation"])}><option value="NONE">없음</option><option value="FADE">페이드</option><option value="PULSE">크기 변화</option><option value="SLIDE">짧은 이동</option><option value="GLOW">빛 강조</option></select></label>
        <label className="text-sm font-semibold">배경<select className={`${field} mt-1 block w-full`} value={draft.backgroundMode} onChange={event => update("backgroundMode", event.target.value as Draft["backgroundMode"])}><option value="NONE">없음</option><option value="SOLID">단색</option><option value="TRANSLUCENT">반투명</option></select></label>
        <label className="text-sm font-semibold">배경색<input className={`${field} mt-1 block w-full p-1`} type="color" value={draft.backgroundColor} onChange={event => update("backgroundColor", event.target.value)} /></label>
        <label className="text-sm font-semibold">배경 투명도 (%)<input className={`${field} mt-1 block w-full`} type="number" min={0} max={100} value={draft.backgroundOpacity} onChange={event => update("backgroundOpacity", Number(event.target.value))} /></label>
        <label className="text-sm font-semibold">테두리<select className={`${field} mt-1 block w-full`} value={String(draft.borderEnabled)} onChange={event => update("borderEnabled", event.target.value === "true")}><option value="false">사용 안 함</option><option value="true">사용</option></select></label>
        <label className="text-sm font-semibold">테두리 색상<input className={`${field} mt-1 block w-full p-1`} type="color" value={draft.borderColor} onChange={event => update("borderColor", event.target.value)} /></label>
        <label className="text-sm font-semibold">테두리 두께<input className={`${field} mt-1 block w-full`} type="number" min={0} max={12} value={draft.borderWidth} onChange={event => update("borderWidth", Number(event.target.value))} /></label>
        <label className="text-sm font-semibold">모서리 둥글기<input className={`${field} mt-1 block w-full`} type="number" min={0} max={80} value={draft.borderRadius} onChange={event => update("borderRadius", Number(event.target.value))} /></label>
        <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2"><button className={primary} disabled={!imageId || busy || (!eventId && events.length >= 5)} onClick={() => void save()}>{eventId ? "변경 저장" : "이벤트 등록"}</button><button className={button} disabled={!imageId || busy} onClick={() => { setEventId(null); setDraft(initial); }}>초기화</button></div>
      </section>
    </div>
  </main>;
}
