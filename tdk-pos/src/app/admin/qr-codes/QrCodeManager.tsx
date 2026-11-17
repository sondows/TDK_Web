"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type QrStatus = "UNUSED" | "IN_USE" | "LOCKED" | "RETIRED";
type TargetType = "UNASSIGNED" | "TABLE_ORDER" | "GUEST_MENU" | "WAITING";
type QrCode = {
  qrCodeId: number;
  managementNumber: string;
  targetType: TargetType;
  status: QrStatus;
  tableId: number | null;
  tableNo: string | null;
  createdAt: string;
  updatedAt: string;
  history: Array<{ actionType: string; description: string | null; createdAt: string }>;
};
type Table = { tableId: number; tableNo: string };
type Filter = "AVAILABLE" | "RETIRED" | "ALL";
type TargetChoice = "UNASSIGNED" | "GUEST_MENU" | "WAITING" | "ORPHANED_TABLE" | `TABLE:${number}`;

const statusLabel: Record<QrStatus, string> = { UNUSED: "미사용", IN_USE: "사용 중", LOCKED: "기존 잠금", RETIRED: "폐기" };

function currentChoice(code: QrCode): TargetChoice {
  if (code.targetType === "TABLE_ORDER") return code.tableId ? `TABLE:${code.tableId}` : "ORPHANED_TABLE";
  return code.targetType;
}

function targetDescription(choice: TargetChoice, tables: Table[]): string {
  if (choice.startsWith("TABLE:")) {
    const tableId = Number(choice.slice("TABLE:".length));
    const table = tables.find(item => item.tableId === tableId);
    return table ? `테이블 ${table.tableNo}` : "테이블";
  }
  return choice === "UNASSIGNED" ? "미연결" : choice === "GUEST_MENU" ? "매장 메뉴 QR" : choice === "WAITING" ? "대기 QR" : "기존 테이블 연결 정보 없음";
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function readDownload(response: Response, fallback: string) {
  if (response.ok) return response.blob();
  const result = await response.json().catch(() => null) as { message?: string } | null;
  throw new Error(result?.message ?? fallback);
}

export default function QrCodeManager() {
  const [codes, setCodes] = useState<QrCode[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [count, setCount] = useState(50);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("AVAILABLE");
  const [background, setBackground] = useState<"transparent" | "white">("transparent");
  const [selected, setSelected] = useState<number[]>([]);
  const [choiceByQr, setChoiceByQr] = useState<Record<number, TargetChoice>>({});
  const [devTestEnabled, setDevTestEnabled] = useState(false);
  const [testSessionFor, setTestSessionFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const visibleCodes = useMemo(() => {
    const normalizedSearch = search.trim().toUpperCase();
    return codes.filter(code => {
      const matchesFilter = filter === "ALL"
        || (filter === "RETIRED" ? code.status === "RETIRED" : code.status === "UNUSED" || code.status === "IN_USE");
      return matchesFilter && (!normalizedSearch || code.managementNumber.includes(normalizedSearch));
    });
  }, [codes, filter, search]);
  const selectedForExport = codes.filter(code => code.status !== "RETIRED" && selected.includes(code.qrCodeId));
  const legacyLockedCount = codes.filter(code => code.status === "LOCKED").length;
  const allVisibleSelected = visibleCodes.filter(code => code.status !== "RETIRED").length > 0
    && visibleCodes.filter(code => code.status !== "RETIRED").every(code => selected.includes(code.qrCodeId));

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/qr-codes", { cache: "no-store" });
    const result = await response.json() as { success?: boolean; codes?: QrCode[]; tables?: Table[]; message?: string };
    if (!response.ok || !result.success) throw new Error(result.message ?? "QR 목록을 불러오지 못했습니다.");
    setCodes(result.codes ?? []);
    setTables(result.tables ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh().catch(reason => setError(reason instanceof Error ? reason.message : "QR 목록 오류")), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/qr-codes/test-session", { cache: "no-store", credentials: "same-origin" })
      .then(response => response.json() as Promise<{ enabled?: boolean }>)
      .then(result => { if (active) setDevTestEnabled(result.enabled === true); })
      .catch(() => { if (active) setDevTestEnabled(false); });
    return () => { active = false; };
  }, []);

  const issue = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/qr-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "발행에 실패했습니다.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "발행에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const updateTarget = async (code: QrCode) => {
    const choice = choiceByQr[code.qrCodeId] ?? currentChoice(code);
    if (choice === currentChoice(code)) return;
    const nextTarget = targetDescription(choice, tables);
    const occupyingQr = choice.startsWith("TABLE:")
      ? codes.find(item => item.qrCodeId !== code.qrCodeId && item.tableId === Number(choice.slice(6)) && item.status !== "RETIRED")
      : undefined;
    let confirmation = `관리번호 ${code.managementNumber}의 연결 대상을 ${nextTarget}(으)로 변경할까요?`;
    if (code.status === "IN_USE" && choice === "UNASSIGNED") {
      confirmation += "\n\n사용 이력이 있는 QR은 재사용할 수 없으므로 폐기됩니다.";
    } else if (code.status === "IN_USE") {
      confirmation += "\n\n기존 연결이 해제됩니다.";
    }
    if (occupyingQr) {
      confirmation += `\n\n해당 테이블에 연결된 ${occupyingQr.managementNumber} QR은 연결 해제 후 영구 폐기됩니다. 새 QR 연결과 함께 하나의 작업으로 처리됩니다.`;
    }
    if (!window.confirm(confirmation)) {
      setChoiceByQr(current => ({ ...current, [code.qrCodeId]: currentChoice(code) }));
      return;
    }

    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = { qrCodeId: code.qrCodeId, targetType: choice.startsWith("TABLE:") ? "TABLE_ORDER" : choice };
      if (choice.startsWith("TABLE:")) body.tableId = Number(choice.slice(6));
      const response = await fetch("/api/admin/qr-codes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "QR 연결 변경에 실패했습니다.");
      setChoiceByQr(current => { const next = { ...current }; delete next[code.qrCodeId]; return next; });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "QR 연결 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const retire = async (code: QrCode) => {
    const linkedTableWarning = code.tableNo ? `\n\n테이블 ${code.tableNo}의 QR 주문 접근이 즉시 중단됩니다.` : "";
    if (!window.confirm(`이 QR(${code.managementNumber})을 폐기하시겠습니까? 폐기된 QR은 다시 사용할 수 없습니다.${linkedTableWarning}`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/qr-codes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qrCodeId: code.qrCodeId, action: "RETIRE" }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "QR 폐기에 실패했습니다.");
      setSelected(current => current.filter(id => id !== code.qrCodeId));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "QR 폐기에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const openCustomerTest = async (code: QrCode) => {
    if (!devTestEnabled || code.targetType !== "TABLE_ORDER" || code.status !== "IN_USE" || !code.tableId) return;
    const testWindow = window.open("about:blank", "_blank");
    if (!testWindow) {
      setError("새 탭이 차단되었습니다. 브라우저에서 팝업을 허용한 후 다시 시도해 주세요.");
      return;
    }
    testWindow.opener = null;
    setTestSessionFor(code.qrCodeId);
    setError("");
    try {
      const response = await fetch("/api/admin/qr-codes/test-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ qrCodeId: code.qrCodeId }),
      });
      const result = await response.json() as { success?: boolean; tableNo?: string; redirectTo?: string; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "고객 화면 테스트를 시작하지 못했습니다.");
      const redirectTo = result.redirectTo === "/qrorder/join-required" ? result.redirectTo : "/qrorder/order";
      testWindow.location.replace(redirectTo);
    } catch (reason) {
      testWindow.close();
      setError(reason instanceof Error ? reason.message : "고객 화면 테스트를 시작하지 못했습니다.");
    } finally {
      setTestSessionFor(null);
    }
  };

  const savePng = async (code: QrCode) => {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/qr-codes/${code.qrCodeId}/png?background=${background}`, { cache: "no-store" });
      downloadBlob(await readDownload(response, "PNG 저장에 실패했습니다."), `${code.managementNumber}.png`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PNG 저장에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  };

  const saveSelectedPngs = async () => {
    if (!selectedForExport.length) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/qr-codes/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qrCodeIds: selectedForExport.map(code => code.qrCodeId), background }) });
      downloadBlob(await readDownload(response, "PNG ZIP 저장에 실패했습니다."), `TDKON_QR_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).replaceAll("-", "")}.zip`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PNG ZIP 저장에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  };

  const toggleSelected = (qrCodeId: number) => setSelected(current => current.includes(qrCodeId)
    ? current.filter(id => id !== qrCodeId)
    : [...current, qrCodeId]);
  const toggleVisible = () => {
    const selectableIds = visibleCodes.filter(code => code.status !== "RETIRED").map(code => code.qrCodeId);
    if (selectableIds.length && selectableIds.every(id => selected.includes(id))) {
      setSelected(current => current.filter(id => !selectableIds.includes(id)));
    } else {
      setSelected(current => [...new Set([...current, ...selectableIds])].slice(0, 500));
    }
  };

  return <div className="w-full text-slate-900">
    <style>{`@media print{@page{size:A4 portrait;margin:10mm}html,body{width:190mm!important;height:auto!important;margin:0!important;background:#fff!important}[data-admin-workspace-shell]{display:block!important;min-height:0!important;background:#fff!important}[data-admin-shell-header],[data-admin-workspace]>aside{display:none!important}[data-admin-workspace]{display:block!important;width:190mm!important;min-height:0!important}[data-admin-main]{display:block!important;box-sizing:border-box!important;width:190mm!important;min-width:0!important;max-width:none!important;margin:0!important;padding:0!important}body *{visibility:hidden!important;box-shadow:none!important}.qr-print-area,.qr-print-area *{visibility:visible!important}.qr-print-area{display:block!important;position:static!important;width:190mm!important;margin:0!important;padding:0!important;background:#fff!important}.qr-print-grid{display:grid!important;grid-template-columns:repeat(4,45mm)!important;grid-auto-rows:50mm!important;gap:3mm!important;width:189mm!important;margin:0!important}.qr-print-card{display:flex!important;box-sizing:border-box!important;width:45mm!important;height:50mm!important;min-width:45mm!important;max-width:45mm!important;min-height:50mm!important;max-height:50mm!important;overflow:hidden!important;break-inside:avoid!important;page-break-inside:avoid!important;border:0.3mm dashed #aaa!important;border-radius:0!important;padding:2mm!important;background:#fff!important;box-shadow:none!important}.qr-print-content{display:flex!important;width:100%!important;height:100%!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:2mm!important}.qr-print-details{display:contents!important}.qr-print-details>div{display:contents!important}.qr-print-image{display:block!important;width:35mm!important;height:35mm!important;max-width:35mm!important;max-height:35mm!important;flex:none!important;object-fit:contain!important}.qr-print-identifier{display:block!important;box-sizing:border-box!important;width:35mm!important;max-width:35mm!important;flex:none!important;overflow:hidden!important;text-align:center!important;white-space:nowrap!important;word-break:normal!important;overflow-wrap:normal!important;font-family:ui-monospace,Consolas,monospace!important;font-size:7pt!important;line-height:1!important;letter-spacing:0!important}.qr-no-print,.qr-print-status,.qr-print-target,.qr-retired-card{display:none!important}.qr-print-area *{color:#000!important;background-color:transparent!important;box-shadow:none!important}}`}</style>
    <header className="qr-no-print flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black">QR 발행·관리</h1><p className="mt-1 text-sm text-slate-500">스티커 식별값과 고객 접근 권한은 별도로 발급됩니다.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">관리번호 검색 <input className="w-36 rounded border px-2 py-2 font-mono" onChange={event => setSearch(event.target.value)} placeholder="YYYYMMDD-0001" type="search" value={search} /></label>
        <label className="text-sm">수량 <input className="w-20 rounded border px-2 py-2" max={500} min={1} onChange={event => setCount(Number(event.target.value))} type="number" value={count} /></label>
        <button className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white" disabled={busy} onClick={() => void issue()} type="button">QR 일괄 발행</button>
        <button className="rounded-lg border px-4 py-2 font-bold" onClick={() => window.print()} type="button">A4 인쇄</button>
        <button className="rounded-lg border px-4 py-2 font-bold" disabled={exporting || !selectedForExport.length} onClick={() => void saveSelectedPngs()} type="button">{exporting ? "PNG 생성 중…" : `PNG 일괄 저장 (${selectedForExport.length})`}</button>
        <button className="rounded-lg border px-4 py-2 font-bold" onClick={() => void refresh()} type="button">새로고침</button>
      </div>
    </header>
    <div className="qr-no-print mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="QR 목록 필터">
        {([ ["AVAILABLE", "사용 가능"], ["RETIRED", "폐기"], ["ALL", "전체"] ] as const).map(([value, label]) => <button aria-pressed={filter === value} className={`rounded-lg px-3 py-2 text-sm font-semibold ${filter === value ? "bg-slate-900 text-white" : "border bg-white"}`} key={value} onClick={() => setFilter(value)} type="button">{label}</button>)}
        <button className="rounded-lg border bg-white px-3 py-2 text-sm" onClick={toggleVisible} type="button">{allVisibleSelected ? "현재 목록 선택 해제" : "현재 목록 전체 선택"}</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>PNG 배경 <select className="ml-2 rounded border bg-white px-2 py-2" onChange={event => setBackground(event.target.value as "transparent" | "white")} value={background}><option value="transparent">투명 배경</option><option value="white">흰색 배경</option></select></label>
        <span className="text-slate-500">투명 PNG는 밝은 바탕에서 사용하세요. ZIP은 한 번에 최대 500개까지 저장할 수 있습니다.</span>
      </div>
    </div>
    {legacyLockedCount > 0 && <p className="qr-no-print mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">기존 잠금 상태 QR {legacyLockedCount}개는 변경 없이 보존했습니다. 전체 필터에서 확인할 수 있습니다.</p>}
    {error && <p className="qr-no-print mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <div className="qr-print-area">
      <div className="qr-print-grid mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleCodes.map(code => {
          const choice = choiceByQr[code.qrCodeId] ?? currentChoice(code);
          const locked = code.status === "LOCKED";
          const retired = code.status === "RETIRED";
          return <article className={`qr-print-card ${retired ? "qr-retired-card" : ""} rounded-xl border border-slate-200 bg-white p-4`} key={code.qrCodeId}>
            <div className="qr-print-content flex items-start gap-3">
              {!retired && <><div className="qr-no-print flex shrink-0 items-start pt-1"><input aria-label={`${code.managementNumber} PNG 선택`} checked={selected.includes(code.qrCodeId)} disabled={!selected.includes(code.qrCodeId) && selectedForExport.length >= 500} onChange={() => toggleSelected(code.qrCodeId)} type="checkbox" /></div><Image alt={`QR ${code.managementNumber}`} className="qr-print-image size-24 shrink-0" height={96} src={`/api/admin/qr-codes/${code.qrCodeId}/image`} unoptimized width={96} /></>}
              <div className="qr-print-details min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2"><strong className="qr-print-identifier font-mono">{code.managementNumber}</strong><span className={`qr-print-status shrink-0 rounded px-2 py-1 text-xs ${locked ? "bg-amber-100 text-amber-900" : "bg-slate-100"}`}>{statusLabel[code.status]}</span></div>
                {!retired && <p className="qr-print-target mt-1 text-sm text-slate-600">현재 연결: {targetDescription(currentChoice(code), tables)}</p>}
                {!retired && <div className="qr-no-print mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <select aria-label={`QR ${code.managementNumber} 연결 대상`} className="min-w-0 rounded-lg border px-2 py-2 text-sm" disabled={busy || locked || retired} onChange={event => setChoiceByQr(current => ({ ...current, [code.qrCodeId]: event.target.value as TargetChoice }))} value={choice}>
                    <option value="UNASSIGNED">미연결</option>
                    {choice === "ORPHANED_TABLE" && <option disabled value="ORPHANED_TABLE">기존 테이블 연결 정보 없음</option>}
                    {tables.map(table => <option key={table.tableId} value={`TABLE:${table.tableId}`}>테이블 {table.tableNo}</option>)}
                    <option value="GUEST_MENU">매장 메뉴 QR</option><option value="WAITING">대기 QR</option>
                  </select>
                  <button className="rounded-lg bg-blue-50 px-3 text-sm font-bold text-blue-700" disabled={busy || locked || retired || choice === currentChoice(code)} onClick={() => void updateTarget(code)} type="button">연결 저장</button>
                </div>}
                {!retired && <div className="qr-no-print mt-2 flex flex-wrap gap-2">
                  <button className="rounded-lg border px-3 py-2 text-xs font-semibold" disabled={exporting || retired} onClick={() => void savePng(code)} type="button">PNG 저장</button>
                  <button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700" disabled={busy || retired} onClick={() => void retire(code)} type="button">폐기</button>
                </div>}
                {devTestEnabled && <button className="qr-no-print mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={testSessionFor !== null || code.status !== "IN_USE" || code.targetType !== "TABLE_ORDER" || !code.tableId} onClick={() => void openCustomerTest(code)} type="button">{testSessionFor === code.qrCodeId ? "테스트 열기 중…" : "고객 화면 테스트"}</button>}
                {retired && <div className="qr-no-print mt-2 text-xs text-slate-600"><p>발행일: {code.managementNumber.slice(0, 8)} · 폐기일: {new Date(code.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p><details className="mt-1"><summary className="cursor-pointer">기존 연결 이력 {code.history.length}건</summary><ul className="mt-1 space-y-1">{code.history.map((item, index) => <li key={`${item.createdAt}-${index}`}>{new Date(item.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {item.description ?? item.actionType}</li>)}</ul></details></div>}
              </div>
            </div>
          </article>;
        })}
      </div>
    </div>
    {!visibleCodes.length && <p className="qr-no-print mt-8 text-center text-slate-500">{codes.length ? "검색 조건에 맞는 QR이 없습니다." : "발행된 QR이 없습니다."}</p>}
  </div>;
}
