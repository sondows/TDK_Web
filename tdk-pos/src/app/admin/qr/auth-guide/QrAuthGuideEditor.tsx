"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import QrAuthGuidePanel from "@/app/qr/QrAuthGuidePanel";
import { readJsonResponse } from "@/lib/api-response";
import { DEFAULT_QR_AUTH_GUIDE, QR_AUTH_GUIDE_MESSAGE_MAX, QR_AUTH_GUIDE_TITLE_MAX, type QrAuthGuide } from "@/lib/qr-auth-guide-model";

export default function QrAuthGuideEditor({ initialGuide }: { initialGuide: QrAuthGuide }) {
  const [guide, setGuide] = useState(initialGuide);
  const [title, setTitle] = useState(initialGuide.title);
  const [message, setMessage] = useState(initialGuide.message);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function resetFile() {
    setPhoto(null);
    setPreviewUrl(null);
    if (input.current) input.current.value = "";
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const body = new FormData();
      body.set("title", title);
      body.set("message", message);
      body.set("photoAction", photo ? "replace" : removePhoto ? "remove" : "keep");
      if (photo) body.set("photo", photo);
      const response = await fetch("/api/admin/qr-auth-guide", { method: "PUT", body });
      const result = await readJsonResponse(response, response.url, "QR 인증 안내 저장") as { guide?: QrAuthGuide; message?: string };
      if (!response.ok || !result.guide) throw new Error(result.message ?? "인증 안내를 저장하지 못했습니다.");
      setGuide(result.guide);
      setTitle(result.guide.title);
      setMessage(result.guide.message);
      resetFile();
      setRemovePhoto(false);
      setStatus("저장했습니다.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "인증 안내를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const imageUrl = previewUrl ?? (removePhoto ? null : guide.imageUrl);
  const fieldClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  return <div className="grid items-start gap-4 lg:grid-cols-2">
    <form className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" onSubmit={save}>
      <fieldset className="space-y-4" disabled={busy}>
        <label className="block space-y-1 text-sm font-semibold">모달 제목
          <input className={fieldClass} maxLength={QR_AUTH_GUIDE_TITLE_MAX} onChange={event => setTitle(event.target.value)} required value={title} />
        </label>
        <label className="block space-y-1 text-sm font-semibold">안내 문구
          <textarea className={fieldClass} maxLength={QR_AUTH_GUIDE_MESSAGE_MAX} onChange={event => setMessage(event.target.value)} required rows={3} value={message} />
        </label>
        <label className="block space-y-1 text-sm font-semibold">안내 사진
          <input accept="image/jpeg,image/png,image/webp" className={fieldClass} onChange={event => {
            const file = event.target.files?.[0];
            if (!file) return;
            setPhoto(file);
            setPreviewUrl(URL.createObjectURL(file));
            setRemovePhoto(false);
          }} ref={input} type="file" />
        </label>
        <p className="text-xs text-slate-600">JPG, PNG, WebP · 최대 10MB</p>
        {imageUrl && <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" onClick={() => {
          resetFile();
          setRemovePhoto(true);
        }} type="button">사진 삭제</button>}
        <div><button className="min-h-11 rounded-lg bg-blue-700 px-5 font-semibold text-white disabled:opacity-50" type="submit">{busy ? "저장 중…" : "저장"}</button></div>
      </fieldset>
      {status && <p className="text-sm text-green-800" role="status">{status}</p>}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </form>
    <section aria-label="고객 인증창 미리보기" className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-slate-600">고객 인증창 미리보기</p>
      <QrAuthGuidePanel guide={{ title: title.trim() || DEFAULT_QR_AUTH_GUIDE.title, message: message.trim() || DEFAULT_QR_AUTH_GUIDE.message, imageUrl }} />
    </section>
  </div>;
}
