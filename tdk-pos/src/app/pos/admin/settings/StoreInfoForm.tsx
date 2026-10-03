"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { StoreInfo } from "@/lib/store-info";

const fields: { key: keyof StoreInfo; label: string; placeholder: string; autoComplete?: string }[] = [
  { key: "storeName", label: "상호명", placeholder: "탑동김치찌개", autoComplete: "organization" },
  { key: "businessNumber", label: "사업자등록번호", placeholder: "000-00-00000" },
  { key: "representative", label: "대표자명", placeholder: "홍길동" },
  { key: "phone", label: "전화번호", placeholder: "064-000-0000", autoComplete: "tel" },
  { key: "address", label: "주소", placeholder: "매장 주소", autoComplete: "street-address" },
];

export default function StoreInfoForm({ initialStoreInfo, initialLogoFileName }: { initialStoreInfo: StoreInfo; initialLogoFileName: string | null }) {
  const router = useRouter();
  const [storeInfo, setStoreInfo] = useState(initialStoreInfo);
  const [savedLogoFileName, setSavedLogoFileName] = useState(initialLogoFileName);
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState("");
  const selectedPreviewUrlRef = useRef("");
  const [removeLogo, setRemoveLogo] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    return () => { if (selectedPreviewUrlRef.current) URL.revokeObjectURL(selectedPreviewUrlRef.current); };
  }, []);

  function clearSelectedPreview() {
    if (selectedPreviewUrlRef.current) URL.revokeObjectURL(selectedPreviewUrlRef.current);
    selectedPreviewUrlRef.current = "";
    setSelectedPreviewUrl("");
  }

  const logoAction = selectedLogo ? "replace" : removeLogo ? "delete" : "keep";
  const logoPreviewUrl = selectedLogo ? selectedPreviewUrl : removeLogo ? "" : savedLogoFileName ? `/api/pos-settings/receipt-logo?v=${encodeURIComponent(savedLogoFileName)}` : "";

  function selectLogo(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 4 * 1024 * 1024) {
      setSelectedLogo(null);
      clearSelectedPreview();
      setRemoveLogo(false);
      if (fileInput.current) fileInput.current.value = "";
      setIsError(true);
      setMessage("PNG 또는 JPG 이미지를 4MB 이하로 선택해 주세요.");
      return;
    }
    clearSelectedPreview();
    const url = URL.createObjectURL(file);
    selectedPreviewUrlRef.current = url;
    setSelectedPreviewUrl(url);
    setSelectedLogo(file);
    setRemoveLogo(false);
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const form = new FormData();
      for (const field of fields) form.set(field.key, storeInfo[field.key]);
      form.set("logoAction", logoAction);
      if (selectedLogo) form.set("receiptLogo", selectedLogo);
      const response = await fetch("/api/pos-settings/store-info", {
        method: "PUT",
        body: form,
      });
      const result = await response.json() as { success?: boolean; message?: string; storeInfo?: StoreInfo; logoFileName?: string | null };
      if (!response.ok || !result.success) {
        setIsError(true);
        setMessage(result.message ?? "매장정보 저장에 실패했습니다. 다시 시도해 주세요.");
        if (response.status === 401 || response.status === 403) router.push("/pos/admin");
        return;
      }
      if (result.storeInfo) setStoreInfo(result.storeInfo);
      setSavedLogoFileName(result.logoFileName ?? null);
      setSelectedLogo(null);
      clearSelectedPreview();
      setRemoveLogo(false);
      if (fileInput.current) fileInput.current.value = "";
      setIsError(false);
      setMessage("매장정보가 저장되었습니다.");
    } catch {
      setIsError(true);
      setMessage("네트워크 오류로 매장정보를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="mx-auto mt-6 max-w-3xl rounded-2xl bg-white p-7 shadow-sm">
    <h2 className="text-2xl font-bold">매장 기본정보</h2>
    <form className="mt-6 space-y-5" onSubmit={(event) => void save(event)}>
      {fields.map((field) => <label className="block text-lg font-bold text-slate-800" key={field.key}>
        {field.label}
        <input
          autoComplete={field.autoComplete ?? "off"}
          className="mt-2 block min-h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-lg font-normal text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200"
          maxLength={255}
          onChange={(event) => { setStoreInfo({ ...storeInfo, [field.key]: event.target.value }); setMessage(""); }}
          placeholder={field.placeholder}
          required
          type={field.key === "phone" ? "tel" : "text"}
          value={storeInfo[field.key]}
        />
      </label>)}
      <div className="border-t border-slate-200 pt-5">
        <h3 className="text-lg font-bold text-slate-800">영수증 로고</h3>
        <div className="mt-3 flex min-h-36 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 p-4">
          {logoPreviewUrl ? <Image alt="영수증 로고 미리보기" className="max-h-28 max-w-full object-contain" height={120} src={logoPreviewUrl} unoptimized width={480} />
            : <span className="text-base text-slate-500">로고 없음 · 상호명을 문자로 출력합니다.</span>}
        </div>
        <p className="mt-2 text-sm text-slate-600">{selectedLogo ? `${selectedLogo.name} · 저장 전` : removeLogo ? "저장하면 로고가 삭제됩니다." : savedLogoFileName ? "현재 저장된 로고" : "등록된 로고가 없습니다."}</p>
        <p className="mt-1 text-sm text-slate-500">PNG/JPG, 최대 4MB · 흑백 로고 이미지를 권장합니다.</p>
        <input accept="image/png,image/jpeg" className="sr-only" onChange={(event) => selectLogo(event.target.files?.[0])} ref={fileInput} type="file" />
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="min-h-14 rounded-xl border border-blue-600 bg-white px-6 text-lg font-bold text-blue-700 active:bg-blue-50 disabled:cursor-not-allowed" disabled={saving} onClick={() => fileInput.current?.click()} type="button">이미지 선택</button>
          <button className="min-h-14 rounded-xl border border-slate-300 bg-white px-6 text-lg font-bold text-slate-700 active:bg-slate-100 disabled:cursor-not-allowed" disabled={saving || (!savedLogoFileName && !selectedLogo)} onClick={() => { setSelectedLogo(null); clearSelectedPreview(); setRemoveLogo(true); setMessage(""); if (fileInput.current) fileInput.current.value = ""; }} type="button">로고 삭제</button>
        </div>
      </div>
      {message && <p aria-live="polite" className={`rounded-xl px-4 py-3 text-base font-semibold ${isError ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`} role="status">{message}</p>}
      <div className="flex justify-end pt-2">
        <button className="min-h-14 min-w-36 rounded-xl bg-blue-600 px-8 text-lg font-bold text-white transition hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed" disabled={saving} type="submit">{saving ? "저장 중" : "저장"}</button>
      </div>
    </form>
  </section>;
}
