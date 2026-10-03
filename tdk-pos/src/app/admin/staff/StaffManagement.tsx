"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StaffSummary } from "@/lib/staff-management";
import StaffModal from "./StaffModal";
import SharedPosPinModal from "./SharedPosPinModal";
import StaffToggle from "./StaffToggle";
import styles from "../admin.module.css";

export default function StaffManagement() {
  const router = useRouter();
  const [rows, setRows] = useState<StaffSummary[]>([]);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<StaffSummary | null | undefined>();
  const [version, setVersion] = useState(0);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/admin-center/staff", { cache: "no-store", signal });
      if (response.status === 401) { router.replace("/admin/login"); return; }
      const result = await response.json() as { success?: boolean; staff?: StaffSummary[] };
      if (!response.ok || !result.success || !Array.isArray(result.staff)) throw new Error("load");
      setRows(result.staff);
      setError("");
    } catch {
      if (!signal.aborted) setError("직원 목록을 불러오지 못했습니다.");
    } finally { if (!signal.aborted) setLoading(false); }
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, version]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return rows.filter(row =>
      (showInactive || row.isActive) &&
      (!term || row.name.toLocaleLowerCase().includes(term) || Boolean(row.adminLoginId?.toLocaleLowerCase().includes(term)))
    );
  }, [rows, search, showInactive]);

  const close = () => { setEditing(undefined); requestAnimationFrame(() => addButtonRef.current?.focus()); };

  return (
    <section aria-label="직원 목록" className={styles.customerSection}>
      <div className={`${styles.customerToolbar} ${styles.staffToolbar}`}>
        <div className={styles.staffFilters}>
          <input aria-label="직원 검색" className={styles.customerSearch} onChange={event => setSearch(event.target.value)} placeholder="이름 또는 관리센터 아이디 검색" type="search" value={search} />
          <StaffToggle checked={showInactive} label="사용중지 직원 보기" onChange={setShowInactive} />
        </div>
        <button className={styles.customerAddButton} onClick={() => setEditing(null)} ref={addButtonRef} type="button">+ 직원등록</button>
      </div>
      <div className={styles.customerTableScroll}>
        <table className={styles.customerTable}>
          <thead><tr><th>이름</th><th>권한</th><th>POS</th><th>관리센터</th><th>상태</th><th>수정</th></tr></thead>
          <tbody>
            {loading ? <tr><td className={styles.customerEmpty} colSpan={6}>직원 목록을 불러오는 중입니다.</td></tr> :
              error ? <tr><td className={styles.customerEmpty} colSpan={6} role="alert">{error}</td></tr> :
              visible.length === 0 ? <tr><td className={styles.customerEmpty} colSpan={6}>{search ? "검색 결과가 없습니다." : "등록된 직원이 없습니다."}</td></tr> :
              visible.map(row => <tr key={row.staffId}>
                <td className={styles.customerName}>{row.name}</td>
                <td>{row.role}</td>
                <td>{row.posEnabled ? "사용" : "미사용"}</td>
                <td>{row.adminEnabled ? row.adminLoginId : "-"}</td>
                <td><span className={row.isActive ? styles.staffStatusActive : styles.staffStatusInactive}>{row.isActive ? "사용" : "사용중지"}</span></td>
                <td><button className={styles.staffEditButton} onClick={() => setEditing(row)} type="button">{row.isShared ? row.posEnabled ? "POS PIN 변경" : "POS PIN 설정" : "수정"}</button></td>
              </tr>)}
          </tbody>
        </table>
      </div>
      {editing?.isShared ? <SharedPosPinModal original={editing} onClose={close} onSaved={() => { close(); setLoading(true); setVersion(current => current + 1); }} /> : editing !== undefined && <StaffModal key={editing?.staffId ?? "new"} original={editing} onClose={close} onSaved={() => { close(); setLoading(true); setVersion(current => current + 1); }} />}
    </section>
  );
}
