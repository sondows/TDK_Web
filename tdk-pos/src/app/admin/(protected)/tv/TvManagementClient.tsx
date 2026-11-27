"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { parseJsonResponse } from "@/lib/api-response";

type Screen = { screenId: number; code: string; name: string; purpose: "MENU" | "ADVERTISEMENT"; width: number; height: number;
  isActive: number; playbackEnabled: number; defaultDurationSeconds: number; loopEnabled: number; syncGroup: string | null;
  fitMode: "CONTAIN" | "COVER"; transitionEffect: "NONE" | "FADE" | "SLIDE" | "ZOOM";
  physicalOrder: number; layoutX: number; layoutY: number; imageCount: number };
type SyncGroup = { groupName: string; intervalSeconds: number; transitionEffect: "NONE" | "FADE" | "SLIDE" | "ZOOM"; epochStartedAt: string };
type TvImage = { imageId: number; screenId: number; originalName: string; width: number; height: number; fileSize: number;
  durationSeconds: number; sortOrder: number; isActive: number; url: string };
type Mode = "screens" | "images" | "playback";
type TvListResponse = { success: boolean; message?: string; screens: Screen[]; images: TvImage[]; groups?: SyncGroup[] };
const api = "/api/admin/tdktv";
const input = "min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm";
const button = "min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-40";
const primary = "min-h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40";
const displayPurpose = (screen: Screen) => screen.code === "DP1" ? "카운터 광고" : "메뉴판 " + (Number(screen.code.slice(2)) - 1);

export default function TvManagementClient({ mode, initialScreen, canIssueTestAuthCode = false }: {
  mode: Mode; initialScreen?: number; canIssueTestAuthCode?: boolean;
}) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [images, setImages] = useState<TvImage[]>([]);
  const [groups, setGroups] = useState<SyncGroup[]>([]);
  const [selected, setSelected] = useState<number | null>(initialScreen ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("불러오는 중입니다.");
  const [progress, setProgress] = useState(0);
  const [testAuthCode, setTestAuthCode] = useState<string | null>(null);

  async function refresh() {
    try {
      const response = await fetch(api, { cache: "no-store" });
      const body = await parseJsonResponse<TvListResponse>(response, response.url, "TV list", "GET");
      if (!body.success) throw Error(body.message || "TV 정보를 불러오지 못했습니다.");
      setScreens(body.screens); setImages(body.images); setGroups(body.groups ?? []);
      setSelected(current => body.screens.some((screen: Screen) => screen.screenId === current) ? current : body.screens[0]?.screenId ?? null);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "TV 정보를 불러오지 못했습니다."); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(api, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await parseJsonResponse<TvListResponse>(response, response.url, "TV list", "GET");
      if (!body.success) throw Error(body.message || "TV 정보를 불러오지 못했습니다.");
      return body;
    }).then(body => {
      setScreens(body.screens); setImages(body.images); setGroups(body.groups ?? []);
      setSelected(current => body.screens.some((screen: Screen) => screen.screenId === current) ? current : body.screens[0]?.screenId ?? null);
      setMessage("");
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "TV 정보를 불러오지 못했습니다."); });
    return () => controller.abort();
  }, []);
  async function send(method: "PATCH" | "DELETE", payload: object) {
    setBusy(true);
    try {
      const response = await fetch(api, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response, response.url, "TV setting update", method);
      if (!result.success) throw Error(result.message || "저장하지 못했습니다.");
      await refresh(); setMessage("저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function issueTestAuthCode() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/tdktv/qr-auth-code/test", { method: "POST", cache: "no-store" });
      const result = await parseJsonResponse<{ success: boolean; code: string | null; message?: string }>(
        response, response.url, "TV test QR authentication code", "POST");
      if (!result.success || !result.code) throw Error(result.message || "시험 인증번호를 발급하지 못했습니다.");
      setTestAuthCode(result.code);
      setMessage(`시험 인증번호 ${result.code}를 DP1과 TDKHOS에 표시합니다. 10초 유효`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "시험 인증번호를 발급하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const patchScreen = (screenId: number, change: Partial<Screen>) => setScreens(current => current.map(screen => screen.screenId === screenId ? { ...screen, ...change } : screen));
  const patchImage = (imageId: number, change: Partial<TvImage>) => setImages(current => current.map(image => image.imageId === imageId ? { ...image, ...change } : image));
  const activeScreen = screens.find(screen => screen.screenId === selected);
  const activeGroup = activeScreen?.syncGroup ? groups.find(group => group.groupName === activeScreen.syncGroup) : undefined;
  const groupMembers = activeScreen?.syncGroup ? screens.filter(screen => screen.syncGroup === activeScreen.syncGroup) : [];
  const visibleImages = images.filter(image => image.screenId === selected).sort((a, b) => a.sortOrder - b.sortOrder || a.imageId - b.imageId);

  async function upload(files: FileList | null) {
    if (!selected || !files?.length) return;
    const list = [...files];
    if (list.length > 5 || list.some(file => file.size > 10 * 1024 * 1024 || !/\.(jpe?g|png|webp)$/i.test(file.name))) {
      setMessage("JPG, PNG, WebP 이미지를 한 번에 5장까지, 장당 10MB 이하로 선택해 주세요."); return;
    }
    setBusy(true); setProgress(0); setMessage("업로드 중입니다.");
    try {
      const form = new FormData(); form.append("screenId", String(selected)); list.forEach(file => form.append("files", file));
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open("POST", api);
        xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => { try { const result = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300 && result.success) resolve();
          else reject(Error(result.message || "이미지를 업로드하지 못했습니다.")); } catch { reject(Error("업로드 응답을 확인할 수 없습니다.")); } };
        xhr.onerror = () => reject(Error("업로드 연결이 끊어졌습니다.")); xhr.send(form);
      });
      await refresh(); setMessage(`${list.length}장 등록했습니다. 권장 해상도는 1920×1080입니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "이미지를 등록하지 못했습니다."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-6xl p-5 text-slate-800 md:p-8">
    <h1 className="text-2xl font-bold">디지털 사이니지</h1>
    <p className="mt-2 text-sm text-slate-600">메뉴판 4대와 카운터 광고 TV 1대의 이미지와 재생 설정을 관리합니다.</p>
    <nav aria-label="디지털 사이니지" className="mt-5 flex flex-wrap gap-2">
      {[["screens", "TV 관리", "/tdkadm/tv"], ["images", "이미지 관리", "/tdkadm/tv/images"], ["playback", "재생 설정", "/tdkadm/tv/playback"]].map(([key, label, href]) =>
        <Link key={key} href={href} className={`${button} inline-flex items-center ${mode === key ? "border-blue-600 text-blue-700" : ""}`}>{label}</Link>)}
    </nav>
    {message && <p role="status" className="mt-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800">{message}{busy && progress > 0 ? ` ${progress}%` : ""}</p>}
    {mode === "screens" && <><p className="mt-4 text-sm text-slate-600">매장 배치(왼쪽→오른쪽): {screens.map(screen => screen.code).join(" → ")}</p><div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{screens.map(screen =>
      <section key={screen.screenId} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><strong>{screen.code}</strong><span className="text-xs text-slate-500">{displayPurpose(screen)}</span></div>
        <label className="mt-4 block text-sm">관리 이름<input className={`${input} mt-1 w-full`} maxLength={100} value={screen.name} onChange={event => patchScreen(screen.screenId, { name: event.target.value })}/></label>
        <p className="mt-3 text-sm text-slate-600">위치 {screen.physicalOrder} · 좌표 ({screen.layoutX},{screen.layoutY}) · {screen.width}×{screen.height} · 이미지 {screen.imageCount}장 · 기본 {screen.defaultDurationSeconds}초</p>
        <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={Boolean(screen.isActive)} onChange={event => patchScreen(screen.screenId, { isActive: Number(event.target.checked) })}/>사용</label>
        <div className="mt-4 flex flex-wrap gap-2"><button className={primary} disabled={busy} onClick={() => void send("PATCH", { kind: "SCREEN", ...screen, isActive: Boolean(screen.isActive), playbackEnabled: Boolean(screen.playbackEnabled), loopEnabled: Boolean(screen.loopEnabled), groupIntervalSeconds: 10, groupTransitionEffect: "FADE" })}>저장</button>
          <Link className={`${button} inline-flex items-center`} href={`/tdkadm/tv/images?screen=${screen.screenId}`}>이미지</Link>
          <Link className={`${button} inline-flex items-center`} href={`/tdkadm/tv/playback?screen=${screen.screenId}`}>재생 설정</Link></div>
      </section>)}</div></>}
    {mode !== "screens" && <div className="mt-6"><label className="text-sm font-semibold">TV 선택 <select className={`${input} ml-2`} value={selected ?? ""} onChange={event => setSelected(Number(event.target.value))}>{screens.map(screen => <option key={screen.screenId} value={screen.screenId}>{screen.code} · {screen.name}</option>)}</select></label></div>}
    {mode === "images" && activeScreen && <div className="mt-5 space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">{activeScreen.name} 이미지 등록</h2>
        <p className="mt-2 text-sm text-slate-600">JPG·PNG·WebP, 각 10MB 이하. 권장 1920×1080, 16:9. 다른 비율은 원본 비율을 유지합니다.</p>
        <input aria-label="TV 이미지 선택" className="mt-3 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy}
          onChange={event => { void upload(event.target.files); event.target.value = ""; }}/></section>
      {visibleImages.map((image, index) => <section key={image.imageId} className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row">
        <Image unoptimized src={image.url} alt={image.originalName} width={192} height={108} className="h-[108px] w-48 rounded bg-slate-100 object-contain"/>
        <div className="min-w-0 flex-1"><p className="break-all font-semibold">{image.originalName}</p><p className="mt-1 text-xs text-slate-500">{image.width}×{image.height} · {(image.fileSize / 1024 / 1024).toFixed(2)}MB · {index + 1}번째</p>
          {(image.width !== 1920 || image.height !== 1080) && <p className="mt-1 text-xs text-amber-700">권장 해상도와 다릅니다. 화면 비율은 유지됩니다.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2"><label className="text-xs">표시 시간 <select className={`${input} ml-1`} value={image.durationSeconds} onChange={event => patchImage(image.imageId, { durationSeconds: Number(event.target.value) })}>
            {![5,10,15,20,30].includes(image.durationSeconds) && <option value={image.durationSeconds}>{image.durationSeconds}초</option>}
            {[5,10,15,20,30].map(seconds => <option key={seconds} value={seconds}>{seconds}초</option>)}</select></label>
            <label className="flex gap-1 text-xs"><input type="checkbox" checked={Boolean(image.isActive)} onChange={event => patchImage(image.imageId, { isActive: Number(event.target.checked) })}/>사용</label>
            <button className={primary} disabled={busy} onClick={() => void send("PATCH", { kind: "IMAGE", imageId: image.imageId, durationSeconds: image.durationSeconds, isActive: Boolean(image.isActive) })}>저장</button>
            <button className={button} disabled={busy || index === 0} onClick={() => void send("PATCH", { kind: "IMAGE", imageId: image.imageId, action: "UP" })}>위로</button>
            <button className={button} disabled={busy || index === visibleImages.length - 1} onClick={() => void send("PATCH", { kind: "IMAGE", imageId: image.imageId, action: "DOWN" })}>아래로</button>
            <button className={button} disabled={busy} onClick={() => { if (window.confirm(`${image.originalName} 이미지를 삭제하시겠습니까?`)) void send("DELETE", { imageId: image.imageId }); }}>삭제</button>
          </div></div></section>)}
      {!visibleImages.length && <p className="rounded-lg bg-white p-6 text-sm text-slate-600">등록된 이미지가 없습니다.</p>}
    </div>}
    {mode === "playback" && activeScreen && <section className="mt-5 max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      {canIssueTestAuthCode && <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-semibold text-amber-900">개발 확인용 인증번호</p>
        <p className="mt-1 text-xs text-amber-800">TDK_POS_TEST에만 발급하며 DP1과 TDKHOS에 공통 표시됩니다.</p>
        <div className="mt-2 flex items-center gap-3"><button className={primary} disabled={busy} onClick={() => void issueTestAuthCode()} type="button">시험 인증번호 발급</button>
          {testAuthCode && <strong className="text-2xl tabular-nums text-slate-900">{testAuthCode}</strong>}</div>
      </div>}
      <h2 className="font-bold">{activeScreen.code} 재생 설정</h2>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={Boolean(activeScreen.playbackEnabled)} onChange={event => patchScreen(activeScreen.screenId, { playbackEnabled: Number(event.target.checked) })}/>재생 활성화</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={Boolean(activeScreen.loopEnabled)} onChange={event => patchScreen(activeScreen.screenId, { loopEnabled: Number(event.target.checked) })}/>순환 재생</label>
      <label className="block text-sm">기본 이미지 표시 시간(초)<input className={`${input} mt-1 block w-32`} type="number" min={1} max={3600} value={activeScreen.defaultDurationSeconds} onChange={event => patchScreen(activeScreen.screenId, { defaultDurationSeconds: Number(event.target.value) })}/></label>
      <label className="block text-sm">화면 표시 방식<select className={`${input} mt-1 block w-full`} value={activeScreen.fitMode} onChange={event => patchScreen(activeScreen.screenId, { fitMode: event.target.value as Screen["fitMode"] })}>
        <option value="CONTAIN">비율 유지 · 전체 이미지 표시</option><option value="COVER">비율 유지 · 화면 채우기</option></select></label>
      <label className="block text-sm">이미지 전환 효과<select className={`${input} mt-1 block w-full`} value={activeScreen.transitionEffect} onChange={event => patchScreen(activeScreen.screenId, { transitionEffect: event.target.value as Screen["transitionEffect"] })}>
        <option value="NONE">효과 없음</option><option value="FADE">부드러운 전환(페이드)</option><option value="SLIDE">좌우 슬라이드</option><option value="ZOOM">확대 전환(줌)</option></select></label>
      <label className="block text-sm">동기화 그룹<input className={`${input} mt-1 block w-full`} maxLength={40} placeholder="예: 그룹 A" value={activeScreen.syncGroup ?? ""} onChange={event => patchScreen(activeScreen.screenId, { syncGroup: event.target.value })}/></label>
      <label className="block text-sm">매장 왼쪽부터 물리적 순서<input className={`${input} mt-1 block w-full`} type="number" min={1} max={100} value={activeScreen.physicalOrder} onChange={event => patchScreen(activeScreen.screenId, { physicalOrder: Number(event.target.value) })}/></label>
      <div className="grid grid-cols-2 gap-3"><label className="block text-sm">배치 X<input className={`${input} mt-1 block w-full`} type="number" min={0} max={99} value={activeScreen.layoutX} onChange={event => patchScreen(activeScreen.screenId, { layoutX: Number(event.target.value) })}/></label>
        <label className="block text-sm">배치 Y<input className={`${input} mt-1 block w-full`} type="number" min={0} max={99} value={activeScreen.layoutY} onChange={event => patchScreen(activeScreen.screenId, { layoutY: Number(event.target.value) })}/></label></div>
      {activeScreen.syncGroup && <><div className="rounded bg-slate-50 p-3 text-sm"><strong>{activeScreen.syncGroup} 구성 TV:</strong> {groupMembers.map(screen => screen.code).join(", ") || "없음"}</div>
        <label className="block text-sm">그룹 공통 전환 간격(초)<input className={`${input} mt-1 block w-full`} type="number" min={1} max={3600} value={activeGroup?.intervalSeconds ?? 10}
          onChange={event => setGroups(current => [...current.filter(group => group.groupName !== activeScreen.syncGroup), { groupName: activeScreen.syncGroup!, intervalSeconds: Number(event.target.value), transitionEffect: activeGroup?.transitionEffect ?? "FADE", epochStartedAt: activeGroup?.epochStartedAt ?? new Date().toISOString() }])}/></label>
        <label className="block text-sm">그룹 공통 전환 효과<select className={`${input} mt-1 block w-full`} value={activeGroup?.transitionEffect ?? "FADE"} onChange={event => setGroups(current => [...current.filter(group => group.groupName !== activeScreen.syncGroup), { groupName: activeScreen.syncGroup!, intervalSeconds: activeGroup?.intervalSeconds ?? 10, transitionEffect: event.target.value as SyncGroup["transitionEffect"], epochStartedAt: activeGroup?.epochStartedAt ?? new Date().toISOString() }])}>
          <option value="NONE">효과 없음</option><option value="FADE">부드러운 전환</option><option value="SLIDE">좌우 슬라이드</option><option value="ZOOM">확대 전환</option></select></label>
        <p className="text-xs text-slate-600">그룹 TV는 공통 간격과 효과를 사용합니다. 이미지별 표시 시간과 TV별 효과는 독립 재생으로 돌아오면 다시 적용됩니다.</p></>}
      <p className="text-xs text-slate-600">그룹 전환은 서버 기준 시각에 맞춰 동작합니다. 배치 좌표는 향후 화면 분할 확장용입니다.</p>
      <button className={primary} disabled={busy} onClick={() => void send("PATCH", { kind: "SCREEN", ...activeScreen, isActive: Boolean(activeScreen.isActive), playbackEnabled: Boolean(activeScreen.playbackEnabled), loopEnabled: Boolean(activeScreen.loopEnabled), saveGroupConfig: true, groupIntervalSeconds: activeGroup?.intervalSeconds ?? 10, groupTransitionEffect: activeGroup?.transitionEffect ?? "FADE" })}>설정 저장</button>
    </section>}
  </main>;
}
