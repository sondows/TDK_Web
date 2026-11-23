"use client";
import { readJsonResponse } from "@/lib/api-response";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { adjustMenuImageCrop, initialMenuImageCrop, moveMenuImageCrop, type CropArea, type CropHandle } from "@/lib/menu-image-crop";

/* The image URL can use the configured external menu storage host. */
/* eslint-disable @next/next/no-img-element */

type ManagedImage = { menuImageId: number; imageType: "POS" | "QR_THUMBNAIL" | "QR_LARGE" | "OTHER"; imageUrl: string; sortOrder: number };
type ManagedMenu = { menuId: number; name: string; categoryName: string | null; categorySortOrder: number | null; sortOrder: number; isActive: number; mainImage: ManagedImage | null; detailImage: ManagedImage | null; detailImages: ManagedImage[] };
type ImageType = "QR_THUMBNAIL" | "QR_LARGE";
type CropDrag = { pointerId: number; mode: "move" | "resize"; handle?: CropHandle; startX: number; startY: number; startArea: CropArea; scale: number };

function CropSelectionEditor({ src, naturalWidth, naturalHeight, aspectRatio, onAreaChange }: { src: string; naturalWidth: number; naturalHeight: number; aspectRatio: number; onAreaChange: (area: CropArea) => void }) {
  const measureRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<CropDrag | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [maxStageHeight, setMaxStageHeight] = useState(0);
  const [area, setArea] = useState<CropArea>(() => initialMenuImageCrop(naturalWidth, naturalHeight, aspectRatio));
  useEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setAvailableWidth(rect.width);
    });
    observer.observe(measure);
    const updateMaxHeight = () => setMaxStageHeight(Math.min(window.innerHeight * 0.58, 520));
    updateMaxHeight();
    window.addEventListener("resize", updateMaxHeight);
    window.visualViewport?.addEventListener("resize", updateMaxHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateMaxHeight);
      window.visualViewport?.removeEventListener("resize", updateMaxHeight);
    };
  }, []);

  const scale = availableWidth && maxStageHeight ? Math.min(availableWidth / naturalWidth, maxStageHeight / naturalHeight) : 0;
  const imageWidth = naturalWidth * scale;
  const imageHeight = naturalHeight * scale;
  const minHeight = Math.min(naturalHeight, 28 / (scale || 1));
  const minWidth = Math.min(naturalWidth, (aspectRatio === 2 ? 56 : 28) / (scale || 1));
  const publish = (next: CropArea) => { setArea(next); onAreaChange(next); };

  const startDrag = (mode: CropDrag["mode"], handle?: CropHandle) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!scale) return;
    event.preventDefault(); event.stopPropagation();
    stageRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, mode, handle, startX: event.clientX, startY: event.clientY, startArea: area, scale };
  };

  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = (event.clientX - drag.startX) / drag.scale;
    const dy = (event.clientY - drag.startY) / drag.scale;
    const original = drag.startArea;
    const next = drag.mode === "move"
      ? moveMenuImageCrop(original, dx, dy, naturalWidth, naturalHeight)
      : adjustMenuImageCrop(original, drag.handle!, dx, dy, naturalWidth, naturalHeight, aspectRatio, minWidth, minHeight);
    publish(next);
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };
  const left = area.x * scale;
  const top = area.y * scale;
  const width = area.width * scale;
  const height = area.height * scale;
  const allHandles: { key: CropHandle; className: string; cursor: string }[] = [
    { key: "nw", className: "-left-1.5 -top-1.5", cursor: "nwse-resize" }, { key: "ne", className: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
    { key: "sw", className: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" }, { key: "se", className: "-bottom-1.5 -right-1.5", cursor: "nwse-resize" },
    { key: "n", className: "-top-1 left-1/2 -translate-x-1/2", cursor: "ns-resize" }, { key: "s", className: "-bottom-1 left-1/2 -translate-x-1/2", cursor: "ns-resize" },
    { key: "w", className: "-left-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" }, { key: "e", className: "-right-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
  ];
  const handles = aspectRatio === 2 ? allHandles.filter(handle => handle.key.length === 2) : allHandles;

  return <div className="relative w-full" ref={measureRef}>
    <div className="relative mx-auto overflow-visible" ref={stageRef} onPointerCancel={endPointer} onPointerMove={movePointer} onPointerUp={endPointer} style={{ width: imageWidth || undefined, height: imageHeight || undefined, touchAction: "none" }}>
    {scale > 0 && <>
      <img alt="자를 원본 이미지" draggable={false} src={src} style={{ position: "absolute", left: 0, top: 0, width: imageWidth, height: imageHeight, maxWidth: "none", maxHeight: "none", userSelect: "none", pointerEvents: "none" }} />
      <div aria-hidden="true" className="pointer-events-none absolute bg-black/40" style={{ left: 0, top: 0, width: imageWidth, height: Math.max(0, area.y) * scale }} />
      <div aria-hidden="true" className="pointer-events-none absolute bg-black/40" style={{ left: 0, top: (area.y + area.height) * scale, width: imageWidth, height: Math.max(0, naturalHeight - area.y - area.height) * scale }} />
      <div aria-hidden="true" className="pointer-events-none absolute bg-black/40" style={{ left: 0, top: area.y * scale, width: Math.max(0, area.x) * scale, height }} />
      <div aria-hidden="true" className="pointer-events-none absolute bg-black/40" style={{ left: (area.x + area.width) * scale, top: area.y * scale, width: Math.max(0, naturalWidth - area.x - area.width) * scale, height }} />
      <div className="absolute border-2 border-blue-500" onPointerDown={startDrag("move")} style={{ left, top, width, height, boxSizing: "border-box", cursor: "move", touchAction: "none" }}>
        {handles.map(handle => <button aria-label={`자르기 영역 ${handle.key} 크기 조절`} className={`absolute z-10 h-3 w-3 rounded-full border-2 border-blue-700 bg-white ${handle.className}`} key={handle.key} onPointerDown={startDrag("resize", handle.key)} style={{ cursor: handle.cursor, touchAction: "none" }} type="button" />)}
      </div>
    </>}
    </div>
  </div>;
}

function imageDimensions(file: Blob) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new window.Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지 파일을 읽지 못했습니다.")); };
    image.src = url;
  });
}

async function cropToWebp(imageUrl: string, crop: CropArea, aspectRatio: number) {
  const image = new window.Image();
  image.src = imageUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(aspectRatio === 2 ? 2 : 1, Math.round(crop.width / aspectRatio) * aspectRatio);
  canvas.height = canvas.width / aspectRatio;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 자를 수 없습니다.");
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("자른 이미지를 만들지 못했습니다.")), "image/webp", 0.94));
}

export default function MenuImageManagementClient() {
  const [menus, setMenus] = useState<ManagedMenu[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<ImageType | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pasteTarget, setPasteTarget] = useState<ImageType>("QR_THUMBNAIL");
  const [cropSource, setCropSource] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropType, setCropType] = useState<ImageType | null>(null);
  const [cropMenuId, setCropMenuId] = useState<number | null>(null);
  const [cropReplaceImageUrl, setCropReplaceImageUrl] = useState<string | null>(null);
  const [cropPixels, setCropPixels] = useState<CropArea | null>(null);
  const [cropImageSize, setCropImageSize] = useState<{ width: number; height: number } | null>(null);
  const [cropError, setCropError] = useState("");
  const fileInputs = useRef<Record<ImageType, HTMLInputElement | null>>({ QR_THUMBNAIL: null, QR_LARGE: null });

  const refresh = async (preferredMenuId?: number | null) => {
    try {
      const response = await fetch("/api/admin/menu-images", { cache: "no-store" });
      const payload = await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string; menus?: ManagedMenu[] };
      if (!response.ok || !payload.success || !payload.menus) throw new Error(payload.message || "메뉴 이미지 목록을 불러오지 못했습니다.");
      setError("");
      setMenus(payload.menus);
      setSelectedMenuId(current => preferredMenuId !== undefined ? preferredMenuId : current ?? payload.menus?.[0]?.menuId ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "메뉴 이미지 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/admin/menu-images", { cache: "no-store" })
      .then(async response => ({ response, payload: await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string; menus?: ManagedMenu[] } }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.success || !payload.menus) throw new Error(payload.message || "메뉴 이미지 목록을 불러오지 못했습니다.");
        setMenus(payload.menus);
        setSelectedMenuId(payload.menus[0]?.menuId ?? null);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "메뉴 이미지 목록을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  const filteredMenus = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return menus.filter(menu => !needle || menu.name.toLocaleLowerCase().includes(needle) || (menu.categoryName ?? "").toLocaleLowerCase().includes(needle));
  }, [menus, search]);
  const groupedMenus = useMemo(() => {
    const groups = new Map<string, ManagedMenu[]>();
    for (const menu of filteredMenus) {
      const label = menu.categoryName || "미분류";
      groups.set(label, [...(groups.get(label) ?? []), menu]);
    }
    return [...groups.entries()];
  }, [filteredMenus]);
  const selected = menus.find(menu => menu.menuId === selectedMenuId) ?? null;

  const closeCropper = () => {
    if (cropSource) URL.revokeObjectURL(cropSource);
    setCropSource(""); setCropFile(null); setCropType(null); setCropMenuId(null); setCropReplaceImageUrl(null); setCropPixels(null); setCropImageSize(null); setCropError("");
  };

  const openCropper = async (imageType: ImageType, file: File, menuId: number, replaceImageUrl: string | null = null) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError("JPG, PNG, WebP 이미지 파일만 사용할 수 있으며 파일 크기는 10MB 이하여야 합니다."); return;
    }
    try {
      const dimensions = await imageDimensions(file);
      if (dimensions.width * dimensions.height > 40_000_000) throw new Error("이미지 해상도가 너무 큽니다. 4천만 화소 이하 이미지를 선택해 주세요.");
      if (cropSource) URL.revokeObjectURL(cropSource);
      setCropFile(file); setCropType(imageType); setCropMenuId(menuId); setCropReplaceImageUrl(replaceImageUrl); setCropSource(URL.createObjectURL(file));
      setCropPixels(initialMenuImageCrop(dimensions.width, dimensions.height, imageType === "QR_THUMBNAIL" ? 1 : 2)); setCropImageSize(dimensions); setCropError("");
      setError(""); setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이미지를 열지 못했습니다.");
    }
  };

  const recrop = async (imageType: ImageType, imageUrl?: string) => {
    if (!selected) return;
    const current = imageType === "QR_THUMBNAIL" ? selected.mainImage : selected.detailImages.find(image => image.imageUrl === imageUrl) ?? selected.detailImage;
    if (!current) return;
    try {
      const fileName = new URL(current.imageUrl, window.location.href).pathname.split("/").pop();
      if (!fileName) throw new Error("현재 이미지 주소를 확인할 수 없습니다.");
      const response = await fetch(`/api/menu-images/${selected.menuId}/${encodeURIComponent(fileName)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("현재 이미지를 불러오지 못했습니다.");
      const blob = await response.blob();
      await openCropper(imageType, new File([blob], fileName, { type: blob.type || "image/webp" }), selected.menuId, imageType === "QR_LARGE" ? current.imageUrl : null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "현재 이미지를 불러오지 못했습니다."); }
  };

  const applyCrop = async () => {
    if (!cropSource || !cropFile || !cropPixels || !cropType || cropMenuId === null || busyType !== null) return;
    setBusyType(cropType); setCropError(""); setError(""); setNotice("");
    try {
      const cropped = await cropToWebp(cropSource, cropPixels, cropType === "QR_THUMBNAIL" ? 1 : 2);
      const form = new FormData(); form.set("imageType", cropType); form.set("image", new File([cropped], "menu-crop.webp", { type: "image/webp" }));
      if (cropReplaceImageUrl) form.set("replaceImageUrl", cropReplaceImageUrl);
      const response = await fetch(`/api/admin/menu-images/${cropMenuId}`, { method: "PUT", body: form });
      const payload = await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "이미지를 저장하지 못했습니다.");
      const savedMenuId = cropMenuId;
      setNotice(cropType === "QR_THUMBNAIL" ? "QR 메인 이미지를 저장했습니다." : "QR 상세 이미지를 저장했습니다.");
      closeCropper();
      await refresh(savedMenuId);
    } catch (reason) {
      setCropError(reason instanceof Error ? reason.message : "이미지를 저장하지 못했습니다.");
    } finally { setBusyType(null); }
  };

  const remove = async (imageType: ImageType, imageUrl?: string) => {
    if (!selected || !window.confirm(imageType === "QR_THUMBNAIL" ? "이 메뉴의 QR 메인 이미지를 삭제할까요?" : "이 메뉴의 QR 상세 이미지를 삭제할까요?")) return;
    setBusyType(imageType); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/menu-images/${selected.menuId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageType, ...(imageUrl ? { imageUrl } : {}) }) });
      const payload = await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "이미지를 삭제하지 못했습니다.");
      setNotice(imageType === "QR_THUMBNAIL" ? "QR 메인 이미지를 삭제했습니다." : "QR 상세 이미지를 삭제했습니다.");
      await refresh(selected.menuId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이미지를 삭제하지 못했습니다.");
    } finally { setBusyType(null); }
  };

  const reorderDetailImage = async (index: number, direction: -1 | 1) => {
    if (!selected || busyType !== null) return;
    const detailImages = [...selected.detailImages];
    const target = index + direction;
    if (target < 0 || target >= detailImages.length) return;
    [detailImages[index], detailImages[target]] = [detailImages[target], detailImages[index]];
    setBusyType("QR_LARGE"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/menu-images/${selected.menuId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ detailImageUrls: detailImages.map(image => image.imageUrl) }) });
      const payload = await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "상세 이미지 순서를 저장하지 못했습니다.");
      await refresh(selected.menuId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상세 이미지 순서를 저장하지 못했습니다."); }
    finally { setBusyType(null); }
  };

  const imageCard = (type: ImageType, title: string, image: ManagedImage | null) => {
    const isBusy = busyType === type;
    return <section className="rounded-2xl border border-slate-200 bg-white p-4" key={type}>
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{title}</h3><p className="mt-1 text-xs text-slate-500">{image ? "등록됨" : "미등록"}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${image ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{image ? "등록" : "미등록"}</span></div>
      <div className="mt-4 flex min-h-48 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
        {image ? <img alt={`${selected?.name ?? "메뉴"} ${title}`} className="max-h-64 w-full object-contain" src={image.imageUrl} /> : <span className="text-sm text-slate-400">이미지가 없습니다.</span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="inline-flex min-h-10 items-center rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50" disabled={busyType !== null || Boolean(cropSource)} onClick={() => fileInputs.current[type]?.click()} type="button">
          {isBusy ? "저장 중…" : image ? "이미지 변경" : "이미지 등록"}
        </button>
        <input accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busyType !== null || Boolean(cropSource)} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file && selected) void openCropper(type, file, selected.menuId); }} ref={element => { fileInputs.current[type] = element; }} type="file" />
        {image && <button className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-50" disabled={busyType !== null || Boolean(cropSource)} onClick={() => void recrop(type)} type="button">다시 자르기</button>}
        {image && <button className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-50" disabled={isBusy || busyType !== null || Boolean(cropSource)} onClick={() => void remove(type)} type="button">삭제</button>}
      </div>
      <p className="mt-2 text-xs text-slate-500">JPG, PNG, WebP · 10MB 이하</p>
      <button className="mt-2 rounded text-left text-xs font-semibold text-blue-700 underline underline-offset-2 disabled:text-slate-400" disabled={busyType !== null || Boolean(cropSource)} onClick={() => setPasteTarget(type)} onFocus={() => setPasteTarget(type)} type="button">이미지를 복사한 뒤 이 영역을 선택하고 Ctrl+V</button>
    </section>;
  };

  return <div className="grid gap-5 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]" onPaste={event => {
    const target = event.target as HTMLElement;
    if (target.isContentEditable || target.closest("input, textarea, select")) return;
    const item = Array.from(event.clipboardData.items).find(clipboardItem => clipboardItem.kind === "file" && clipboardItem.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file || !selected) return;
    event.preventDefault();
    void openCropper(pasteTarget, file, selected.menuId);
  }}>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4"><h2 className="font-bold">메뉴 선택</h2><input aria-label="메뉴 검색" className="mt-3 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500" onChange={event => setSearch(event.target.value)} placeholder="메뉴명 또는 분류 검색" value={search} /></div>
      <div className="max-h-[65vh] overflow-y-auto p-2">
        {loading && <p className="p-4 text-sm text-slate-500">메뉴를 불러오는 중입니다.</p>}
        {!loading && groupedMenus.length === 0 && <p className="p-4 text-sm text-slate-500">검색 결과가 없습니다.</p>}
        {groupedMenus.map(([category, items]) => <div key={category}><h3 className="px-3 pb-1 pt-3 text-xs font-bold text-slate-400">{category}</h3>{items.map(menu => <button aria-pressed={selectedMenuId === menu.menuId} className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm ${selectedMenuId === menu.menuId ? "bg-blue-50 font-bold text-blue-800" : "text-slate-700 hover:bg-slate-50"}`} key={menu.menuId} onClick={() => setSelectedMenuId(menu.menuId)} type="button"><span className="truncate">{menu.name}</span><span className="shrink-0 text-[11px] text-slate-400">{menu.isActive ? "사용 중" : "미사용"}</span></button>)}</div>)}
      </div>
    </section>
    <section className="min-w-0">
      {!selected && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">왼쪽에서 메뉴를 선택해 주세요.</div>}
      {selected && <><div className="mb-4 rounded-2xl border border-slate-200 bg-white px-5 py-4"><p className="text-xs font-bold text-slate-500">{selected.categoryName ?? "미분류"}</p><h2 className="mt-1 text-xl font-bold">{selected.name}</h2></div><div className="grid gap-4 lg:grid-cols-2">{imageCard("QR_THUMBNAIL", "QR 메인 이미지", selected.mainImage)}<section className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">QR 상세 이미지</h3><p className="mt-1 text-xs text-slate-500">{selected.detailImages.length ? `${selected.detailImages.length}장 등록` : "미등록"}</p></div><button className="inline-flex min-h-10 items-center rounded-lg bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={busyType !== null || Boolean(cropSource)} onClick={() => { setPasteTarget("QR_LARGE"); fileInputs.current.QR_LARGE?.click(); }} type="button">상세 이미지 추가</button><input accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busyType !== null || Boolean(cropSource)} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file && selected) void openCropper("QR_LARGE", file, selected.menuId); }} ref={element => { fileInputs.current.QR_LARGE = element; }} type="file" /></div>{selected.detailImages.length ? <ol className="mt-4 space-y-3">{selected.detailImages.map((image, index) => <li className="rounded-xl border border-slate-200 p-3" key={image.menuImageId}><div className="flex items-center gap-3"><img alt={`${selected.name} 상세 이미지 ${index + 1}`} className="h-14 w-28 shrink-0 rounded-lg bg-slate-100 object-cover" src={image.imageUrl} /><div className="min-w-0 flex-1"><strong className="text-sm">{index === 0 ? "첫 번째 이미지" : `이미지 ${index + 1}`}</strong><p className="mt-1 truncate text-xs text-slate-500">{image.imageUrl.split("/").pop()}</p></div></div><div className="mt-3 flex flex-wrap gap-2"><button className="min-h-9 rounded-lg border px-3 text-xs font-semibold disabled:opacity-40" disabled={busyType !== null || Boolean(cropSource) || index === 0} onClick={() => void reorderDetailImage(index, -1)} type="button">앞으로</button><button className="min-h-9 rounded-lg border px-3 text-xs font-semibold disabled:opacity-40" disabled={busyType !== null || Boolean(cropSource) || index === selected.detailImages.length - 1} onClick={() => void reorderDetailImage(index, 1)} type="button">뒤로</button><button className="min-h-9 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" disabled={busyType !== null || Boolean(cropSource)} onClick={() => void recrop("QR_LARGE", image.imageUrl)} type="button">다시 자르기</button><button className="min-h-9 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busyType !== null || Boolean(cropSource)} onClick={() => void remove("QR_LARGE", image.imageUrl)} type="button">삭제</button></div></li>)}</ol> : <p className="mt-4 grid min-h-48 place-items-center rounded-xl bg-slate-100 text-sm text-slate-400">등록된 상세 이미지가 없습니다.</p>}<p className="mt-3 text-xs text-slate-500">첫 번째 상세 이미지가 QR 상세창의 대표 사진으로 표시됩니다.</p></section></div></>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
      {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700" role="status">{notice}</p>}
    </section>
    {cropSource && cropType && <div aria-label="이미지 자르기" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-3" onPaste={event => { const item = Array.from(event.clipboardData.items).find(clipboardItem => clipboardItem.kind === "file" && clipboardItem.type.startsWith("image/")); const file = item?.getAsFile(); if (file && cropMenuId !== null) { event.preventDefault(); event.stopPropagation(); void openCropper(cropType, file, cropMenuId); } }} role="dialog">
      <div className="flex max-h-[95dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4"><div><h2 className="font-extrabold">이미지 자르기</h2><p className="mt-1 text-xs text-slate-500">{cropType === "QR_THUMBNAIL" ? "사각형을 드래그해 이동하고 모서리나 변을 조절하세요. 메인 이미지는 정사각형으로 잘립니다." : "사각형을 드래그해 이동하고 모서리나 변을 조절하세요."}</p></div><button aria-label="자르기 취소" className="rounded-lg px-3 py-2 text-sm font-semibold" disabled={busyType !== null} onClick={closeCropper} type="button">닫기</button></div>
        <div className="relative w-full">{cropImageSize && <CropSelectionEditor key={cropSource} naturalHeight={cropImageSize.height} naturalWidth={cropImageSize.width} onAreaChange={setCropPixels} src={cropSource} aspectRatio={cropType === "QR_THUMBNAIL" ? 1 : 2} />}</div>
        {cropError && <p className="mx-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{cropError}</p>}
        <div className="grid grid-cols-2 gap-3 p-4 pt-0"><button className="min-h-11 rounded-xl border border-slate-300 font-bold disabled:opacity-50" disabled={busyType !== null} onClick={closeCropper} type="button">취소</button><button className="min-h-11 rounded-xl bg-blue-700 font-bold text-white disabled:opacity-50" disabled={busyType !== null || !cropFile || !cropPixels} onClick={() => void applyCrop()} type="button">{busyType === cropType ? "저장 중…" : "적용"}</button></div>
      </div>
    </div>}
  </div>;
}
