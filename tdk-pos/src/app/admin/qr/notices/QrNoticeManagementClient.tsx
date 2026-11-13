"use client";

import { useState } from "react";
import Image from "next/image";
import type { QrNoticeBlock } from "@/lib/qr-notice-model";

export type QrNoticeAdminItem = { id: string; title: string; blocks: QrNoticeBlock[]; isActive: boolean; sortOrder: number; updatedAt: string };
type Draft = { id: string | null; title: string; blocks: QrNoticeBlock[]; isActive: boolean };

const newTextBlock = (style: "paragraph" | "heading" | "bullet" = "paragraph"): QrNoticeBlock => ({ id: crypto.randomUUID(), type: "text", text: "", style, bold: false, highlight: false });

function NoticeBlockView({ block }: { block: QrNoticeBlock }) {
  if (block.type === "image") return <Image alt="안내 이미지" className="my-2 h-auto max-w-full rounded-xl" height={900} src={`/api/qr/notices/images/${block.assetId}`} unoptimized width={1200} />;
  const className = `${block.style === "heading" ? "text-lg font-bold" : "text-sm leading-6"} ${block.bold ? "font-bold" : ""} ${block.highlight ? "rounded bg-amber-100 px-1" : ""} ${block.style === "bullet" ? "before:mr-2 before:content-['•']" : ""}`;
  return <p className={`${className} whitespace-pre-wrap break-words text-slate-700`}>{block.text || "내용을 입력해 주세요."}</p>;
}

export default function QrNoticeManagementClient({ initialNotices, initialError }: { initialNotices: QrNoticeAdminItem[]; initialError: string }) {
  const [notices, setNotices] = useState(initialNotices);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError);

  const discardDraft = () => {
    if (draft) {
      const assetIds = draft.blocks.flatMap(block => block.type === "image" ? [block.assetId] : []);
      if (assetIds.length) void fetch("/api/admin/qr-notices/images", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetIds }) }).catch(() => undefined);
    }
    setDraft(null);
  };
  const startNew = () => { discardDraft(); setMessage(""); setDraft({ id: null, title: "", blocks: [newTextBlock()], isActive: true }); };
  const edit = (notice: QrNoticeAdminItem) => { discardDraft(); setMessage(""); setDraft({ id: notice.id, title: notice.title, blocks: notice.blocks, isActive: notice.isActive }); };
  const setBlocks = (update: (blocks: QrNoticeBlock[]) => QrNoticeBlock[]) => setDraft(current => current ? { ...current, blocks: update(current.blocks) } : current);

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    if ((draft?.blocks.length ?? 0) + files.length > 120) { setMessage("안내문은 텍스트와 이미지를 합쳐 120개까지 추가할 수 있습니다."); return; }
    setBusy(true); setMessage("");
    const uploaded: QrNoticeBlock[] = [];
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set("file", file);
        const response = await fetch("/api/admin/qr-notices/images", { method: "POST", body: form, credentials: "same-origin" });
        const payload = await response.json() as { success?: boolean; assetId?: string; message?: string };
        if (!response.ok || !payload.success || !payload.assetId) throw new Error(payload.message ?? "이미지를 업로드하지 못했습니다.");
        uploaded.push({ id: crypto.randomUUID(), type: "image", assetId: payload.assetId });
      }
      setBlocks(current => [...current, ...uploaded]);
    } catch (error) {
      const assetIds = uploaded.flatMap(block => block.type === "image" ? [block.assetId] : []);
      if (assetIds.length) void fetch("/api/admin/qr-notices/images", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetIds }) }).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : "이미지를 업로드하지 못했습니다.");
    }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) { setMessage("안내문 제목을 입력해 주세요."); return; }
    if (title.length > 100) { setMessage("안내문 제목은 100자 이내로 입력해 주세요."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(draft.id ? `/api/admin/qr-notices/${draft.id}` : "/api/admin/qr-notices", {
        method: draft.id ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, blocks: draft.blocks }),
      });
      const payload = await response.json() as { success?: boolean; notice?: QrNoticeAdminItem | null; message?: string };
      if (!response.ok || !payload.success || !payload.notice) throw new Error(payload.message ?? "안내문을 저장하지 못했습니다.");
      setNotices(current => {
        const found = current.some(item => item.id === payload.notice!.id);
        return found ? current.map(item => item.id === payload.notice!.id ? payload.notice! : item) : [...current, payload.notice!].sort((a, b) => a.sortOrder - b.sortOrder);
      });
      setDraft(null);
      setMessage("안내문을 저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "안내문을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const toggleActive = async (notice: QrNoticeAdminItem) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/qr-notices/${notice.id}`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !notice.isActive }) });
      const payload = await response.json() as { success?: boolean; notice?: QrNoticeAdminItem; message?: string };
      if (!response.ok || !payload.success || !payload.notice) throw new Error(payload.message ?? "표시 상태를 변경하지 못했습니다.");
      setNotices(current => current.map(item => item.id === payload.notice!.id ? payload.notice! : item));
    } catch (error) { setMessage(error instanceof Error ? error.message : "표시 상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const remove = async (notice: QrNoticeAdminItem) => {
    if (!window.confirm(`'${notice.title}' 안내문을 삭제할까요?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/qr-notices/${notice.id}`, { method: "DELETE", credentials: "same-origin" });
      const payload = await response.json() as { success?: boolean; notices?: QrNoticeAdminItem[]; message?: string };
      if (!response.ok || !payload.success || !payload.notices) throw new Error(payload.message ?? "안내문을 삭제하지 못했습니다.");
      setNotices(payload.notices);
      if (draft?.id === notice.id) setDraft(null);
      setMessage("안내문을 삭제했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "안내문을 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const move = async (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= notices.length || busy) return;
    const next = [...notices]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/qr-notices", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: next.map(item => item.id) }) });
      const payload = await response.json() as { success?: boolean; notices?: QrNoticeAdminItem[]; message?: string };
      if (!response.ok || !payload.success || !payload.notices) throw new Error(payload.message ?? "순서를 저장하지 못했습니다.");
      setNotices(payload.notices);
    } catch (error) { setMessage(error instanceof Error ? error.message : "순서를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">고객 QR에는 사용 중인 안내문 제목만 표시됩니다.</p><button className="min-h-11 rounded-xl bg-blue-700 px-4 font-bold text-white" disabled={busy} onClick={startNew} type="button">+ 안내문 추가</button></div>
    {message && <p className={`rounded-xl p-3 text-sm ${message.includes("못") || message.includes("입력") || message.includes("확인") ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`} role="status">{message}</p>}
    {notices.length ? <ol className="space-y-3">{notices.map((notice, index) => <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4" key={notice.id}>
      <div className="flex gap-2"><button aria-label="안내문 위로" className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-semibold disabled:opacity-40" disabled={busy || index === 0} onClick={() => void move(index, -1)} type="button">위로</button><button aria-label="안내문 아래로" className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-semibold disabled:opacity-40" disabled={busy || index === notices.length - 1} onClick={() => void move(index, 1)} type="button">아래로</button></div>
      <div className="min-w-0 flex-1"><p className="truncate font-bold">{index + 1}. {notice.title}</p><p className="mt-1 text-xs text-slate-500">{notice.isActive ? "고객 화면 표시 중" : "미표시 · 내용 보존"} · 수정 {new Date(notice.updatedAt).toLocaleString("ko-KR")}</p></div>
      <button aria-pressed={notice.isActive} className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-semibold" disabled={busy} onClick={() => void toggleActive(notice)} type="button">{notice.isActive ? "표시 ON" : "표시 OFF"}</button>
      <button className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-semibold" disabled={busy} onClick={() => edit(notice)} type="button">수정</button>
      <button className="min-h-10 rounded-lg bg-red-50 px-3 text-sm font-semibold text-red-700" disabled={busy} onClick={() => void remove(notice)} type="button">삭제</button>
    </li>)}</ol> : <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">등록된 안내문이 없습니다. 안내문을 추가하면 QR 메뉴에 제목이 표시됩니다.</p>}
    {draft && <section aria-label="안내문 편집" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-extrabold">{draft.id ? "안내문 수정" : "안내문 추가"}</h2><button className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-semibold" disabled={busy} onClick={discardDraft} type="button">닫기</button></div>
      <label className="block text-sm font-semibold">제목<input className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3" maxLength={100} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="예: 우리집 김치찌개가 특별한 점" value={draft.title} /></label>
      <div className="flex flex-wrap gap-2"><button className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-semibold" disabled={busy} onClick={() => setBlocks(blocks => [...blocks, newTextBlock()])} type="button">+ 본문</button><button className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-semibold" disabled={busy} onClick={() => setBlocks(blocks => [...blocks, newTextBlock("heading")])} type="button">+ 소제목</button><button className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-semibold" disabled={busy} onClick={() => setBlocks(blocks => [...blocks, newTextBlock("bullet")])} type="button">+ 글머리표</button><label className="flex min-h-10 cursor-pointer items-center rounded-lg bg-blue-50 px-3 text-sm font-semibold text-blue-800">이미지 추가<input accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} multiple onChange={event => { void uploadImages(event.target.files); event.currentTarget.value = ""; }} type="file" /></label></div>
      {draft.blocks.length ? <ol className="space-y-3">{draft.blocks.map((block, index) => <li className="rounded-xl border border-slate-200 p-3" key={block.id}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold text-slate-500">{block.type === "image" ? "이미지" : block.style === "heading" ? "소제목" : block.style === "bullet" ? "글머리표" : "본문"}</span><div className="flex gap-1"><button aria-label="블록 위로" className="rounded bg-slate-100 px-2 py-1 text-xs" disabled={index === 0 || busy} onClick={() => setBlocks(items => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} type="button">↑</button><button aria-label="블록 아래로" className="rounded bg-slate-100 px-2 py-1 text-xs" disabled={index === draft.blocks.length - 1 || busy} onClick={() => setBlocks(items => { const next = [...items]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })} type="button">↓</button><button className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700" disabled={busy} onClick={() => { setBlocks(items => items.filter((_, i) => i !== index)); if (block.type === "image") void fetch("/api/admin/qr-notices/images", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: block.assetId }) }); }} type="button">삭제</button></div></div>
        {block.type === "image" ? <Image alt="안내 이미지 미리보기" className="max-h-80 max-w-full rounded-lg object-contain" height={900} src={`/api/qr/notices/images/${block.assetId}`} unoptimized width={1200} /> : <><div className="mb-2 flex flex-wrap gap-2"><select aria-label="본문 형식" className="rounded-lg border border-slate-300 px-2 py-1 text-sm" onChange={event => setBlocks(items => items.map((item, i) => i === index && item.type === "text" ? { ...item, style: event.target.value as "paragraph" | "heading" | "bullet" } : item))} value={block.style}><option value="paragraph">본문</option><option value="heading">소제목</option><option value="bullet">글머리표</option></select><button aria-pressed={block.bold} className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-bold" onClick={() => setBlocks(items => items.map((item, i) => i === index && item.type === "text" ? { ...item, bold: !item.bold } : item))} type="button">굵게</button><button aria-pressed={block.highlight} className="rounded-lg border border-slate-300 bg-amber-50 px-2 py-1 text-sm" onClick={() => setBlocks(items => items.map((item, i) => i === index && item.type === "text" ? { ...item, highlight: !item.highlight } : item))} type="button">강조</button></div><textarea className="min-h-24 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm leading-6" maxLength={5000} onChange={event => setBlocks(items => items.map((item, i) => i === index && item.type === "text" ? { ...item, text: event.target.value } : item))} placeholder="안내 내용을 입력하세요. 줄바꿈과 문단 나누기가 유지됩니다." value={block.text} /></>}
      </li>)}</ol> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">본문이나 이미지를 추가해 주세요.</p>}
      <div className="rounded-xl bg-slate-50 p-4"><p className="mb-3 text-xs font-bold text-slate-500">고객 화면 미리보기</p><h3 className="mb-3 text-lg font-extrabold">{draft.title || "안내문 제목"}</h3><div className="space-y-3">{draft.blocks.map(block => <NoticeBlockView block={block} key={block.id} />)}</div></div>
      <div className="flex flex-wrap justify-end gap-2"><button className="min-h-11 rounded-xl bg-slate-100 px-4 font-semibold" disabled={busy} onClick={discardDraft} type="button">취소</button><button className="min-h-11 rounded-xl bg-blue-700 px-5 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void save()} type="button">{busy ? "처리 중…" : "저장"}</button></div>
    </section>}
  </div>;
}
