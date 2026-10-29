"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SortableHeader from "@/app/admin/SortableHeader";
import { nextGridSort, sortGridRows, type GridSortDirection, type GridSortState } from "@/lib/admin-grid-sort";
import { type StaffSummary } from "@/lib/staff-management";
import StaffModal from "./StaffModal";
import StaffToggle from "./StaffToggle";
import styles from "../admin.module.css";

type StaffSortKey = "name" | "pos" | "adminEnabled" | "status";

export default function StaffManagement() {
  const router = useRouter();
  const [rows, setRows] = useState<StaffSummary[]>([]);
  const [hosPermissionAvailable, setHosPermissionAvailable] = useState(false);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<StaffSummary | null | undefined>();
  const [version, setVersion] = useState(0);
  const [sort, setSort] = useState<GridSortState<StaffSortKey> | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/admin-center/staff", { cache: "no-store", signal });
      if (response.status === 401) { router.replace("/tdkadm/login"); return; }
      const result = await response.json() as { success?: boolean; staff?: StaffSummary[]; hosPermissionAvailable?: boolean };
      if (!response.ok || !result.success || !Array.isArray(result.staff)) throw new Error("load");
      setRows(result.staff);
      setHosPermissionAvailable(result.hosPermissionAvailable === true);
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
      (!term || row.name.toLocaleLowerCase().includes(term) || row.loginId?.toLocaleLowerCase().includes(term))
    );
  }, [rows, search, showInactive]);
  const sortedVisible = useMemo(() => sort ? sortGridRows(visible, sort,
    { name: "text", pos: "text", adminEnabled: "text", status: "text" },
    (row, key) => key === "name" ? row.name : key === "pos" ? (row.posEnabled ? "사용" : "미사용")
      : key === "adminEnabled" ? (row.adminEnabled ? "사용" : "미사용") : row.isActive ? "사용" : "사용중지",
  ) : visible, [visible, sort]);
  const toggleSort = (key: StaffSortKey) => setSort(current => current ? nextGridSort(current, key, "asc") : { key, direction: "asc" });
  const sortDirection = (key: StaffSortKey): GridSortDirection => sort?.key === key ? sort.direction : "desc";

  const close = () => { setEditing(undefined); requestAnimationFrame(() => addButtonRef.current?.focus()); };

  return (
    <section aria-label="직원 목록" className={styles.customerSection}>
      <div className={`${styles.customerToolbar} ${styles.staffToolbar}`}>
        <div className={styles.staffFilters}>
          <input aria-label="직원 검색" className={styles.customerSearch} onChange={event => setSearch(event.target.value)} placeholder="이름 또는 ID 검색" type="search" value={search} />
          <StaffToggle checked={showInactive} label="사용중지 직원 보기" onChange={setShowInactive} variant="employeeFilter" />
        </div>
        <button className={styles.customerAddButton} onClick={() => setEditing(null)} ref={addButtonRef} type="button">+ 직원등록</button>
      </div>
      {!hosPermissionAvailable && <p className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">HOS 권한 컬럼이 DB에 없어 직원 목록은 표시하지만 HOS 권한 설정은 비활성화했습니다.</p>}
      <div className={styles.customerTableScroll}>
        <table className={`${styles.customerTable} ${styles.staffTable}`}>
          <thead><tr>
            <SortableHeader active={sort?.key === "name"} direction={sortDirection("name")} onClick={() => toggleSort("name")}>직원 이름</SortableHeader>
            <th>ID</th>
            <SortableHeader active={sort?.key === "pos"} direction={sortDirection("pos")} onClick={() => toggleSort("pos")}>POS</SortableHeader>
            <th>KDS</th>
            <th>HOS</th>
            <SortableHeader active={sort?.key === "adminEnabled"} direction={sortDirection("adminEnabled")} onClick={() => toggleSort("adminEnabled")}>ADM 사용</SortableHeader>
            <SortableHeader active={sort?.key === "status"} direction={sortDirection("status")} onClick={() => toggleSort("status")}>상태</SortableHeader><th>수정</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td className={styles.customerEmpty} colSpan={8}>직원 목록을 불러오는 중입니다.</td></tr> :
              error ? <tr><td className={styles.customerEmpty} colSpan={8} role="alert">{error}</td></tr> :
              sortedVisible.length === 0 ? <tr><td className={styles.customerEmpty} colSpan={8}>{search ? "검색 결과가 없습니다." : "등록된 직원이 없습니다."}</td></tr> :
              sortedVisible.map(row => <tr key={row.staffId}>
                <td className={styles.customerName}>{row.name}</td>
                <td>{row.loginId ?? "ID 미설정"}</td>
                <td>{row.posEnabled ? "사용" : "미사용"}</td>
                <td>{row.kdsEnabled ? "사용" : "미사용"}</td>
                <td>{hosPermissionAvailable ? row.hosEnabled ? "사용" : "미사용" : "미설정"}</td>
                <td>{row.adminEnabled ? "사용" : "미사용"}</td>
                <td><span className={row.isActive ? styles.staffStatusActive : styles.staffStatusInactive}>{row.isActive ? "사용" : "사용중지"}</span></td>
                <td>{!row.isShared && <button className={styles.staffEditButton} onClick={() => setEditing(row)} type="button">수정</button>}{row.isShared && <span className="text-xs text-slate-500">로그인 제외 계정</span>}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      {editing !== undefined && <StaffModal key={editing?.staffId ?? "new"} hosPermissionAvailable={hosPermissionAvailable} original={editing} onClose={close} onSaved={() => { close(); setLoading(true); setVersion(current => current + 1); }} />}
    </section>
  );
}
