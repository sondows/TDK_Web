"use client";

import { useEffect, useState } from "react";

export default function QrDevTestBadge() {
  const [tableNo, setTableNo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/qr/dev-test-session", { cache: "no-store", credentials: "same-origin" })
      .then(response => response.json() as Promise<{ isTest?: boolean; tableNo?: string | null }>)
      .then(result => { if (active && result.isTest && result.tableNo) setTableNo(result.tableNo); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!tableNo) return null;
  const endTest = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/qr/dev-test-session", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("failed");
      setTableNo(null);
      window.location.replace("/qrorder");
    } finally {
      setBusy(false);
    }
  };

  return <aside className="mx-auto mt-2 flex w-fit max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-1 pl-3 pr-1 text-xs font-bold text-amber-950" aria-label="개발 주문 테스트 모드">
    <span>개발 테스트 · 테이블 {tableNo}</span>
    <button className="rounded-full bg-amber-200 px-2.5 py-1.5 disabled:opacity-50" disabled={busy} onClick={() => void endTest().catch(() => setBusy(false))} type="button">{busy ? "종료 중" : "테스트 종료"}</button>
  </aside>;
}
