"use client";

import Cropper from "react-easy-crop";
import Image from "next/image";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Area } from "react-easy-crop";
import { QR_TITLE_ASPECT_RATIO, type QrPublicTitleSettings, type QrTitleCrop } from "@/lib/qr-title-model";
import QrStoreTitle from "@/app/qr/QrStoreTitle";

export type QrTitleAdminPhoto = {
  photoId: string;
  assetId: string;
  sortOrder: number;
  isActive: boolean;
  crop: QrTitleCrop;
  previewUrl: string;
  sourceUrl: string;
};

type Props = { initialPhotos: QrTitleAdminPhoto[]; initialError: string; previewSettings: QrPublicTitleSettings };

function imageDimensions(file: Blob) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new window.Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("사진을 읽을 수 없습니다.")); };
    image.src = url;
  });
}

async function cropToWebp(imageUrl: string, crop: Area) {
  const image = new window.Image();
  image.src = imageUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.width);
  canvas.height = Math.round(crop.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("사진 자르기를 시작할 수 없습니다.");
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("편집한 사진을 만들 수 없습니다.")), "image/webp", 0.94));
}

export default function QrTitleManagementClient({ initialPhotos, initialError, previewSettings }: Props) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [error, setError] = useState(initialError);
  const [storeName, setStoreName] = useState(previewSettings.storeName);
  const [storeNameMessage, setStoreNameMessage] = useState("");
  const [storeNameBusy, setStoreNameBusy] = useState(false);
  const [storeNameSaved, setStoreNameSaved] = useState(false);
  const [subtitle, setSubtitle] = useState(previewSettings.subtitle);
  const [subtitleMessage, setSubtitleMessage] = useState("");
  const [subtitleBusy, setSubtitleBusy] = useState(false);
  const [subtitleSaved, setSubtitleSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cropSource, setCropSource] = useState("");
  const [original, setOriginal] = useState<File | null>(null);
  const [editing, setEditing] = useState<QrTitleAdminPhoto | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const activePhotos = useMemo(() => photos.filter(photo => photo.isActive), [photos]);
  const virtualSettings = useMemo(() => ({
    ...previewSettings,
    storeName,
    subtitle,
    photos: activePhotos.map(photo => ({ id: photo.photoId, imageUrl: photo.previewUrl, alt: "매장 소개 사진" })),
  }), [activePhotos, previewSettings, storeName, subtitle]);

  const saveStoreName = async () => {
    setStoreNameBusy(true); setStoreNameMessage(""); setStoreNameSaved(false);
    try {
      const response = await fetch("/api/admin/qr-title/store-name", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName }),
      });
      const payload = await response.json() as { success?: boolean; storeName?: string; message?: string };
      if (!response.ok || !payload.success || typeof payload.storeName !== "string") throw new Error(payload.message || "상호명을 저장하지 못했습니다.");
      setStoreName(payload.storeName); setStoreNameSaved(true);
    } catch (reason) { setStoreNameMessage(reason instanceof Error ? reason.message : "상호명을 저장하지 못했습니다."); }
    finally { setStoreNameBusy(false); }
  };

  const saveSubtitle = async () => {
    setSubtitleBusy(true); setSubtitleMessage(""); setSubtitleSaved(false);
    try {
      const response = await fetch("/api/admin/qr-title/subtitle", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subtitle }),
      });
      const payload = await response.json() as { success?: boolean; subtitle?: string; message?: string };
      if (!response.ok || !payload.success || typeof payload.subtitle !== "string") throw new Error(payload.message || "보조 문구를 저장하지 못했습니다.");
      setSubtitle(payload.subtitle);
      setSubtitleSaved(true);
    } catch (reason) { setSubtitleMessage(reason instanceof Error ? reason.message : "보조 문구를 저장하지 못했습니다."); }
    finally { setSubtitleBusy(false); }
  };

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/qr-title", { cache: "no-store" });
    const payload = await response.json() as { success?: boolean; photos?: QrTitleAdminPhoto[]; message?: string };
    if (!response.ok || !payload.success || !payload.photos) throw new Error(payload.message || "사진 목록을 불러오지 못했습니다.");
    setPhotos(payload.photos);
  }, []);

  const openCropper = async (file: File, photo: QrTitleAdminPhoto | null) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      setError("JPG, PNG, WebP 사진만 선택할 수 있으며 파일은 10MB 이하여야 합니다.");
      return;
    }
    try {
      const dimensions = await imageDimensions(file);
      if (dimensions.width * dimensions.height > 40_000_000) throw new Error("사진 해상도가 너무 큽니다. 4천만 픽셀 이하의 사진을 선택해 주세요.");
      setOriginal(file);
      setEditing(photo);
      setCropSource(URL.createObjectURL(file));
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPixels(null);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "사진을 열지 못했습니다."); }
  };

  const closeCropper = () => {
    if (cropSource) URL.revokeObjectURL(cropSource);
    setCropSource(""); setOriginal(null); setEditing(null); setPixels(null);
  };

  const saveCrop = async () => {
    if (!original || !pixels) return;
    setBusy(true); setError("");
    try {
      const cropped = await cropToWebp(cropSource, pixels);
      const sourceDimensions = await imageDimensions(original);
      const cropInfo: QrTitleCrop = {
        x: Math.round(pixels.x), y: Math.round(pixels.y), width: Math.round(pixels.width), height: Math.round(pixels.height),
        sourceWidth: sourceDimensions.width, sourceHeight: sourceDimensions.height,
      };
      const form = new FormData();
      if (editing) form.set("photoId", editing.photoId);
      form.set("original", original, original.name);
      form.set("cropped", cropped, "qr-title.webp");
      form.set("crop", JSON.stringify(cropInfo));
      const response = await fetch("/api/admin/qr-title", { method: "POST", body: form });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "사진을 저장하지 못했습니다.");
      await refresh();
      const nextFile = pendingFiles[0];
      setPendingFiles(current => current.slice(1));
      closeCropper();
      if (nextFile) window.setTimeout(() => void openCropper(nextFile, null), 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "사진을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const saveOrder = async (next: QrTitleAdminPhoto[]) => {
    const normalized = next.map((photo, sortOrder) => ({ ...photo, sortOrder }));
    setPhotos(normalized);
    try {
      const response = await fetch("/api/admin/qr-title", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: normalized.map(({ photoId, sortOrder, isActive }) => ({ photoId, sortOrder, isActive })) }) });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "사진 설정을 저장하지 못했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "사진 설정을 저장하지 못했습니다."); await refresh().catch(() => undefined); }
  };

  const remove = async (photo: QrTitleAdminPhoto) => {
    if (!window.confirm("이 사진과 원본 파일을 삭제할까요?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/qr-title/photos/${photo.photoId}`, { method: "DELETE" });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "사진을 삭제하지 못했습니다.");
      const rest = photos.filter(item => item.photoId !== photo.photoId);
      await saveOrder(rest);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "사진을 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <p className="text-sm leading-6 text-slate-600">사진 원본은 다시 편집할 수 있도록 보관합니다. 자른 WebP 파일을 QR 화면에 공개하며, 사진을 삭제하면 원본과 편집본을 함께 지웁니다.</p>
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold text-slate-500">고객 화면에 표시되는 매장 상호명</p><p className="mt-1 text-xs text-slate-500">기존 매장 정보를 사용하며, 수정 시 해당 정보를 사용하는 영수증 등 다른 화면에도 반영됩니다.</p></div>
        <a className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700" href="/tdkadm/business-hours">영업시간설정</a>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 space-y-1 text-sm font-semibold text-slate-700">매장 상호명<input className="block min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base text-slate-900" maxLength={60} onChange={event => { setStoreName(event.target.value); setStoreNameSaved(false); setStoreNameMessage(""); }} placeholder="탑동김치찌개" value={storeName} /><span className="text-xs font-normal text-slate-500">최대 60자 · 저장 후 QR 타이틀 미리보기에 바로 반영됩니다.</span></label>
        <button className="min-h-11 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={storeNameBusy} onClick={() => void saveStoreName()} type="button">{storeNameBusy ? "저장 중…" : "상호명 저장"}</button>
      </div>
      {storeNameMessage && <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{storeNameMessage}</p>}
      {storeNameSaved && <p className="mt-2 text-sm font-semibold text-emerald-700" role="status">상호명을 저장했습니다.</p>}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 space-y-1 text-sm font-semibold text-slate-700">상단 보조 문구<input className="block min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base text-slate-900" maxLength={40} onChange={event => { setSubtitle(event.target.value); setSubtitleSaved(false); setSubtitleMessage(""); }} placeholder="SINCE 2003 · 제주 탑동 · 정성가득 김치찌개" value={subtitle} /><span className="text-xs font-normal text-slate-500">비워 두면 표시하지 않습니다. 최대 40자, 한 줄로 표시됩니다.</span></label>
        <button className="min-h-11 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={subtitleBusy} onClick={() => void saveSubtitle()} type="button">{subtitleBusy ? "저장 중…" : "보조 문구 저장"}</button>
      </div>
      {subtitleMessage && <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{subtitleMessage}</p>}
      {subtitleSaved && <p className="mt-2 text-sm font-semibold text-emerald-700" role="status">보조 문구를 저장했습니다.</p>}
    </section>
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
    <div className="flex flex-wrap items-center gap-3"><button className="min-h-11 rounded-xl bg-blue-700 px-5 font-bold text-white disabled:opacity-50" disabled={busy || Boolean(cropSource)} onClick={() => picker.current?.click()} type="button">사진 추가</button><input accept="image/jpeg,image/png,image/webp" className="sr-only" multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.currentTarget.value = ""; if (files[0]) { setPendingFiles(files.slice(1)); void openCropper(files[0], null); } }} ref={picker} type="file" /><span className="text-sm text-slate-500">{photos.length}장 등록 · {activePhotos.length}장 사용 중</span></div>
    {photos.length > 0 ? <ol className="space-y-3">{photos.map((photo, index) => <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3" key={photo.photoId}><Image alt={`사진 ${index + 1} 미리보기`} className="h-24 w-24 rounded-xl object-cover" height={96} src={photo.previewUrl} unoptimized width={96} /><div className="min-w-0 flex-1"><p className="font-bold">사진 {index + 1}</p><p className="text-xs text-slate-500">{photo.isActive ? "QR에 표시" : "미사용"}</p><div className="mt-2 flex flex-wrap gap-2"><button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold disabled:opacity-40" disabled={!index || busy} onClick={() => { const next = [...photos]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void saveOrder(next); }} type="button">위로</button><button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold disabled:opacity-40" disabled={index === photos.length - 1 || busy} onClick={() => { const next = [...photos]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; void saveOrder(next); }} type="button">아래로</button><button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold" disabled={busy} onClick={() => { void fetch(photo.sourceUrl).then(response => { if (!response.ok) throw new Error(); return response.blob(); }).then(blob => openCropper(new File([blob], "qr-title-source", { type: blob.type }), photo)).catch(() => setError("원본 사진을 불러오지 못했습니다.")); }} type="button">다시 자르기</button><button aria-pressed={photo.isActive} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold" disabled={busy} onClick={() => void saveOrder(photos.map(item => item.photoId === photo.photoId ? { ...item, isActive: !item.isActive } : item))} type="button">{photo.isActive ? "사용 중" : "미사용"}</button><button className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" disabled={busy} onClick={() => void remove(photo)} type="button">삭제</button></div></div></li>)}</ol> : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">사진을 등록하지 않으면 QR 메뉴가 기존 화면으로 표시됩니다.</p>}
    <section className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[2rem] border-[8px] border-slate-800 bg-slate-50 shadow-xl">
      <div className="bg-slate-900 px-4 py-2 text-center text-xs text-white">모바일 타이틀 미리보기 · 기기 390 × 800</div>
      <div className="h-[800px] overflow-y-auto bg-white">
        <QrStoreTitle photoHeightPx={374 * 0.75} photoViewportHeightPx={374 * 0.375} settings={virtualSettings} />
        <div className="border-b border-slate-200 px-4 pb-3 pt-5">
          <div className="flex items-center justify-between"><span className="font-bold text-slate-900">QR 메뉴</span><span className="text-xs text-slate-500">한국어⌄</span></div>
          <div className="mt-4 flex gap-5 overflow-hidden whitespace-nowrap border-b border-slate-200 text-sm"><span className="border-b-2 border-blue-700 pb-2 font-bold text-blue-700">전체</span><span className="pb-2 text-slate-600">추천 메뉴</span><span className="pb-2 text-slate-600">식사류</span></div>
        </div>
        <div className="space-y-3 p-4"><p className="text-sm font-bold text-slate-700">메뉴 목록</p><div className="h-20 rounded-xl bg-slate-100" /><div className="h-20 rounded-xl bg-slate-100" /></div>
      </div>
    </section>
    {cropSource && <div aria-label="사진 자르기" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-3" role="dialog"><div className="flex max-h-[95dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white"><div className="flex items-center justify-between p-4"><h2 className="font-extrabold">사진 자르기</h2><button className="rounded-lg px-3 py-2 text-sm font-semibold" onClick={() => { setPendingFiles([]); closeCropper(); }} type="button">취소</button></div><div className="relative h-[min(62dvh,560px)] min-h-64 bg-slate-950"><Cropper aspect={QR_TITLE_ASPECT_RATIO} crop={crop} image={cropSource} onCropChange={setCrop} onCropComplete={(_, area) => setPixels(area)} onZoomChange={setZoom} zoom={zoom} /></div><label className="flex items-center gap-3 px-4 py-4 text-sm">확대/축소<input className="w-full accent-blue-700" max="3" min="1" onChange={event => setZoom(Number(event.target.value))} step="0.01" type="range" value={zoom} /></label><div className="px-4 pb-4"><p className="mb-3 text-xs text-slate-500">화면에서 보이는 영역이 QR 타이틀 사진으로 저장됩니다. 드래그하여 초점을 맞추세요.</p><button className="min-h-12 w-full rounded-xl bg-blue-700 font-bold text-white disabled:opacity-50" disabled={busy || !pixels} onClick={() => void saveCrop()} type="button">{busy ? "저장 중…" : "편집 결과 저장"}</button></div></div></div>}
  </div>;
}
