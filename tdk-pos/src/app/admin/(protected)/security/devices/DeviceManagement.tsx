"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MANAGED_DEVICE_TYPES, type ManagedDevicePermissions, type ManagedDeviceType } from "@/lib/managed-device-types";
import styles from "./devices.module.css";

type ManagedDevice = {
  deviceId: number;
  deviceCode: string | null;
  deviceName: string;
  deviceType: ManagedDeviceType;
  status: "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED";
  posEnabled: number;
  admEnabled: number;
  kdsEnabled: number;
  hosEnabled: number;
  confirmationCode: string | null;
  registeredByStaffId: number | null;
  requestedAt: string;
  requestExpiresAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};
type Tab = "pending" | "registered";
type Operation = "approve" | "deny" | "update" | "revoke" | "delete";
type DeviceFields = { deviceName?: string; deviceType?: ManagedDeviceType } & Partial<ManagedDevicePermissions>;

const defaultPermissions = (type: ManagedDeviceType): ManagedDevicePermissions => ({
  posEnabled: type === "POS", admEnabled: type === "ADM",
  kdsEnabled: type === "KDS", hosEnabled: type === "HOS",
});
const hasPermission = (value: ManagedDevicePermissions) => Object.values(value).some(Boolean);

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const statusText: Record<ManagedDevice["status"], string> = {
  PENDING: "승인 대기", APPROVED: "정상", DENIED: "거부", REVOKED: "차단", EXPIRED: "만료",
};

export default function DeviceManagement() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin-center/devices", { cache: "no-store" });
      const result = await response.json().catch(() => null) as { success?: boolean; devices?: ManagedDevice[]; message?: string; code?: string } | null;
      if (response.status === 401) { router.replace("/tdkadm/login"); return; }
      if (!response.ok) {
        const reason = result?.message ?? response.statusText ?? "API 응답을 확인해 주세요.";
        throw new Error(`기기 목록 조회 실패 (HTTP ${response.status}${result?.code ? ` · ${result.code}` : ""}): ${reason}`);
      }
      if (!result?.success || !Array.isArray(result.devices)) {
        throw new Error(result?.message ?? "기기 목록 API 응답 형식이 올바르지 않습니다.");
      }
      setDevices(result.devices);
    } catch (cause) {
      setError(cause instanceof TypeError
        ? "기기 목록 API에 연결하지 못했습니다. 네트워크 또는 Caddy 프록시를 확인해 주세요."
        : cause instanceof Error ? cause.message : "기기 목록 조회에 실패했습니다.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const operate = async (action: Operation, deviceId: number, fields: DeviceFields = {}) => {
    if (busyId !== null) return false;
    setBusyId(deviceId); setError("");
    try {
      const response = await fetch("/api/admin-center/devices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, deviceId, ...fields }),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; message?: string; code?: string } | null;
      if (!response.ok || !result?.success) {
        const reason = result?.message ?? response.statusText ?? "API 응답을 확인해 주세요.";
        throw new Error(`기기 변경 실패 (HTTP ${response.status}${result?.code ? ` · ${result.code}` : ""}): ${reason}`);
      }
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof TypeError
        ? "기기관리 API에 연결하지 못했습니다. 네트워크 또는 Caddy 프록시를 확인해 주세요."
        : cause instanceof Error ? cause.message : "기기 정보를 변경하지 못했습니다.");
      return false;
    } finally { setBusyId(null); }
  };

  const pending = devices.filter(device => device.status === "PENDING");
  const registered = devices.filter(device => device.status !== "PENDING");
  return <section className={styles.panel}>
    <div aria-label="기기 상태 탭" className={styles.tabs} role="tablist">
      <button aria-selected={tab === "pending"} className={`${styles.tab} ${tab === "pending" ? styles.tabActive : ""}`} onClick={() => setTab("pending")} role="tab" type="button">승인 대기 ({loading || error ? "—" : pending.length})</button>
      <button aria-selected={tab === "registered"} className={`${styles.tab} ${tab === "registered" ? styles.tabActive : ""}`} onClick={() => setTab("registered")} role="tab" type="button">등록 기기 ({loading || error ? "—" : registered.length})</button>
    </div>
    <div className={styles.body}>
      {error && <p className={styles.notice} role="alert">{error}</p>}
      <p className={styles.hint}>ADM·HOS 등록 권한은 기기관리 기록용입니다. ADM 로그인은 기존 방식으로 이용하며 HOS 접속 정책은 별도로 적용됩니다.</p>
      {tab === "pending" && <p className={styles.hint}>기기에 표시된 6자리 확인번호를 실제 화면과 대조한 뒤 승인하세요. 요청은 10분 후 만료됩니다.</p>}
      {loading ? <p className={styles.loading}>불러오는 중…</p>
        : tab === "pending" ? pending.length === 0 ? <p className={styles.empty}>승인 대기 중인 요청이 없습니다.</p>
          : pending.map(device => <PendingDevice key={device.deviceId} device={device} busy={busyId === device.deviceId} onOperate={operate} />)
          : registered.length === 0 ? <p className={styles.empty}>등록된 기기가 없습니다.</p>
            : registered.map(device => <RegisteredDevice key={device.deviceId} device={device} busy={busyId === device.deviceId} onOperate={operate} />)}
    </div>
  </section>;
}

function PermissionInputs({ value, onChange, disabled }: { value: ManagedDevicePermissions; onChange: (value: ManagedDevicePermissions) => void; disabled: boolean }) {
  return <div className={styles.permissions}>
    <label className={styles.permission}><input checked={value.posEnabled} disabled={disabled} onChange={event => onChange({ ...value, posEnabled: event.target.checked })} type="checkbox" /> POS 사용</label>
    <label className={styles.permission}><input checked={value.admEnabled} disabled={disabled} onChange={event => onChange({ ...value, admEnabled: event.target.checked })} type="checkbox" /> ADM 등록</label>
    <label className={styles.permission}><input checked={value.kdsEnabled} disabled={disabled} onChange={event => onChange({ ...value, kdsEnabled: event.target.checked })} type="checkbox" /> KDS 사용</label>
    <label className={styles.permission}><input checked={value.hosEnabled} disabled={disabled} onChange={event => onChange({ ...value, hosEnabled: event.target.checked })} type="checkbox" /> HOS 등록</label>
  </div>;
}

function PendingDevice({ device, busy, onOperate }: { device: ManagedDevice; busy: boolean; onOperate: (action: Operation, id: number, fields?: DeviceFields) => Promise<boolean> }) {
  const [deviceName, setDeviceName] = useState(device.deviceName);
  const [deviceType, setDeviceType] = useState<ManagedDeviceType>(device.deviceType);
  const [permissions, setPermissions] = useState<ManagedDevicePermissions>(() => defaultPermissions(device.deviceType));
  return <article className={styles.card}>
    <div className={styles.cardHeader}>
      <div><h2 className={styles.deviceName}>{device.deviceName}</h2><p className={styles.subline}>{device.deviceType} · 요청 {dateTime(device.requestedAt)}</p>
        <span aria-label="기기 확인번호" className={styles.code}>{device.confirmationCode ?? "------"}</span>
      </div>
      <span className={`${styles.badge} ${styles.badgePending}`}>{statusText[device.status]}</span>
    </div>
    <p className={styles.subline}>요청자 직원 번호: {device.registeredByStaffId ?? "—"} · 만료: {dateTime(device.requestExpiresAt)}</p>
    <div className={styles.fields}>
      <label className={styles.field}>기기 이름<input className={styles.input} maxLength={120} onChange={event => setDeviceName(event.target.value)} value={deviceName} /></label>
      <label className={styles.field}>기기 종류<select className={styles.input} disabled={busy} onChange={event => { const type = event.target.value as ManagedDeviceType; setDeviceType(type); setPermissions(defaultPermissions(type)); }} value={deviceType}>{MANAGED_DEVICE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <div className={styles.field}>승인할 권한<PermissionInputs disabled={busy} onChange={setPermissions} value={permissions} /></div>
    </div>
    <div className={styles.actions}>
      <button className={`${styles.button} ${styles.buttonPrimary}`} disabled={busy || !deviceName.trim() || !hasPermission(permissions)} onClick={() => void onOperate("approve", device.deviceId, { deviceName, deviceType, ...permissions })} type="button">{busy ? "처리 중…" : "승인"}</button>
      <button className={`${styles.button} ${styles.buttonDanger}`} disabled={busy} onClick={() => void onOperate("deny", device.deviceId)} type="button">거부</button>
    </div>
  </article>;
}

function RegisteredDevice({ device, busy, onOperate }: { device: ManagedDevice; busy: boolean; onOperate: (action: Operation, id: number, fields?: DeviceFields) => Promise<boolean> }) {
  const [deviceName, setDeviceName] = useState(device.deviceName);
  const [deviceType, setDeviceType] = useState<ManagedDeviceType>(device.deviceType);
  const [permissions, setPermissions] = useState<ManagedDevicePermissions>({
    posEnabled: device.posEnabled === 1, admEnabled: device.admEnabled === 1,
    kdsEnabled: device.kdsEnabled === 1, hosEnabled: device.hosEnabled === 1,
  });
  const canEdit = device.status === "APPROVED";
  const badgeClass = device.status === "APPROVED" ? styles.badgeApproved : device.status === "PENDING" ? styles.badgePending
    : device.status === "REVOKED" ? styles.badgeRevoked : device.status === "EXPIRED" ? styles.badgeExpired : styles.badgeDenied;
  return <article className={styles.card}>
    <div className={styles.cardHeader}>
      <div><h2 className={styles.deviceName}>{device.deviceName}</h2><p className={styles.subline}>{device.deviceCode ?? "기기 ID 없음"} · {device.deviceType}</p></div>
      <span className={`${styles.badge} ${badgeClass}`}>{statusText[device.status]}</span>
    </div>
    <div className={styles.fields}>
      <label className={styles.field}>기기 이름<input className={styles.input} disabled={!canEdit || busy} maxLength={120} onChange={event => setDeviceName(event.target.value)} value={deviceName} /></label>
      <label className={styles.field}>기기 종류<select className={styles.input} disabled={!canEdit || busy} onChange={event => setDeviceType(event.target.value as ManagedDeviceType)} value={deviceType}>{MANAGED_DEVICE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <div className={styles.field}>사용 권한<PermissionInputs disabled={!canEdit || busy} onChange={setPermissions} value={permissions} /></div>
    </div>
    <div className={styles.subline}>등록: {dateTime(device.approvedAt ?? device.createdAt)} · 마지막 접속: {dateTime(device.lastUsedAt)} · 인증 만료: {dateTime(device.expiresAt)}</div>
    {device.registeredByStaffId && <div className={styles.subline}>등록 요청 직원 번호: {device.registeredByStaffId}</div>}
    <div className={styles.actions}>
      {device.status === "APPROVED" && <>
        <button className={styles.button} disabled={busy || !deviceName.trim() || !hasPermission(permissions)} onClick={() => void onOperate("update", device.deviceId, { deviceName, deviceType, ...permissions })} type="button">변경 저장</button>
        <button className={`${styles.button} ${styles.buttonDanger}`} disabled={busy} onClick={() => void onOperate("revoke", device.deviceId)} type="button">승인 취소</button>
      </>}
      <button className={`${styles.button} ${styles.buttonDanger}`} disabled={busy} onClick={() => {
        if (window.confirm(`${device.deviceName} 기기 기록을 삭제할까요? 기존 인증은 즉시 무효가 됩니다.`)) void onOperate("delete", device.deviceId);
      }} type="button">삭제</button>
    </div>
  </article>;
}
