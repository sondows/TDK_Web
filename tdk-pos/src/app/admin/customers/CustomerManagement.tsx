"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CustomerSummary } from "@/lib/customer";
import CustomerCreateModal from "./CustomerCreateModal";
import CustomerList from "./CustomerList";
import CustomerTradeModal from "./CustomerTradeModal";
import styles from "../admin.module.css";

export default function CustomerManagement() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerSummary | null>(null);
  const [tradingCustomer, setTradingCustomer] = useState<CustomerSummary | null>(null);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setListError("");
      try {
        const query = new URLSearchParams({ search: search.trim() });
        if (includeInactive) query.set("includeInactive", "1");
        const response = await fetch(`/api/customers?${query.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json() as { success?: boolean; customers?: CustomerSummary[] };
        if (!response.ok || !result.success || !Array.isArray(result.customers)) {
          throw new Error(response.status === 401 ? "login" : response.status === 403 ? "forbidden" : "load");
        }
        setCustomers(result.customers);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCustomers([]);
        if (error instanceof Error && error.message === "login") {
          router.replace("/admin/login");
          setListError("관리센터 로그인이 필요합니다.");
        } else {
          setListError(error instanceof Error && error.message === "forbidden" ? "고객관리 권한이 없습니다." : "고객 목록을 불러오지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, includeInactive, refreshKey, router]);

  const closeCreate = () => {
    setCreateOpen(false);
    requestAnimationFrame(() => addButtonRef.current?.focus());
  };

  const created = () => {
    setLoading(true);
    setSearch("");
    setRefreshKey(value => value + 1);
    closeCreate();
  };

  const updated = () => {
    setLoading(true);
    setSearch("");
    setRefreshKey(value => value + 1);
    setEditingCustomer(null);
  };

  return (
    <section aria-label="고객 목록" className={styles.customerSection}>
      <div className={styles.customerToolbar}>
        <div className={styles.customerToolbarControls}>
        <input
          aria-label="고객 검색"
          className={styles.customerSearch}
          maxLength={100}
          onChange={event => { setSearch(event.target.value); setLoading(true); }}
          placeholder="이름, 담당, 전화 또는 이메일 검색"
          type="search"
          value={search}
        />
        <label className={styles.customerInactiveToggle}>
          <input checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} type="checkbox" />
          미사용 포함
        </label>
        </div>
        <button
          className={styles.customerAddButton}
          onClick={() => setCreateOpen(true)}
          ref={addButtonRef}
          type="button"
        >
          + 고객등록
        </button>
      </div>
      <CustomerList customers={customers} error={listError} loading={loading} onEdit={customer => setEditingCustomer(customer)} onTrade={customer => setTradingCustomer(customer)} search={search} />
      {createOpen && <CustomerCreateModal customer={null} onClose={closeCreate} onSaved={created} />}
      {editingCustomer && <CustomerCreateModal customer={editingCustomer} onClose={() => setEditingCustomer(null)} onSaved={updated} />}
      {tradingCustomer && <CustomerTradeModal customer={tradingCustomer} onChanged={() => setRefreshKey(value => value + 1)} onClose={() => setTradingCustomer(null)} />}
    </section>
  );
}
