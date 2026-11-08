"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Fan = { fanId: number; name: string; positionX: number; positionY: number; isVisible: boolean; sortOrder: number; state: "on" | "off" | "unknown"; error: string | null };
type FanResponse = { success: boolean; configured?: boolean; fans?: Fan[] };
type FanNotice = { message: string; source: "status" | "command" };

function fanErrorMessage(code: string | undefined, httpStatus?: number) {
  switch (code) {
    case "POS_AUTH_REQUIRED": return "POS 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
    case "HA_NOT_CONFIGURED": return "Home Assistant URL 또는 서버 토큰 설정을 확인해 주세요.";
    case "HA_AUTH_FAILED": return "Home Assistant 토큰 인증에 실패했습니다. 토큰 유효성을 확인해 주세요.";
    case "HA_PERMISSION_DENIED": return "Home Assistant 계정에 switch 제어 권한이 없습니다.";
    case "HA_ENTITY_NOT_FOUND": return "Home Assistant에서 선풍기 엔티티를 찾지 못했습니다.";
    case "HA_CONNECTION_FAILED": return "Home Assistant 서버에 연결할 수 없습니다.";
    case "HA_COMMAND_FAILED": return `Home Assistant가 제어 명령을 거부했습니다${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`;
    case "HA_STATE_NOT_CONFIRMED": return "명령은 전달됐지만 장치 상태가 바뀐 것을 확인하지 못했습니다.";
    case "HA_STATE_UNAVAILABLE": return "Home Assistant에서 선풍기 상태를 조회하지 못했습니다.";
    case "HA_STATE_UNKNOWN": return "선풍기 상태가 unknown 또는 unavailable입니다. 상태 확인 후 다시 시도해 주세요.";
    case "HA_INVALID_RESPONSE": return "Home Assistant의 응답 형식을 확인할 수 없습니다.";
    case "FAN_NOT_CONFIGURED": return "선풍기 배치 설정을 확인할 수 없습니다. ADM 배치 설정을 저장해 주세요.";
    case "POS_FAN_QUERY_FAILED": return "POS에서 선풍기 설정을 조회하지 못했습니다.";
    default: return "선풍기 요청에 실패했습니다. 네트워크와 서버 로그를 확인해 주세요.";
  }
}

async function fetchFans(): Promise<FanResponse> {
  const response = await fetch("/api/pos/fans", { cache: "no-store" });
  const result = await response.json() as FanResponse & { code?: string };
  if (!response.ok || !result.success) throw Object.assign(new Error("선풍기 상태 조회 실패"), { code: result.code });
  return result;
}

function FanGlyph({ state }: { state: Fan["state"] }) {
  const color = state === "on" ? "#16a34a" : state === "off" ? "#64748b" : "#d97706";
  return <svg aria-hidden="true" className={state === "on" ? "size-7 motion-safe:animate-spin" : "size-7"} style={{ color, animationDuration: "2.6s" }} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="2.4" fill="currentColor" />
    <path d="M16 13.1c-1.8-3.1-1.9-8.6.1-9.2 3.2-.9 5.2 5.8 2.4 10.1M18.5 17.4c3.6-.3 8.3 2.5 7.7 4.5-1 3.2-7.9 1.8-10.5-2M13.5 17.3c-1.8 3.1-6.4 5.7-7.8 4.2-2.2-2.5 2.7-7.5 7.7-7.4" fill="currentColor" opacity=".88" />
  </svg>;
}

export default function PosFanLayer() {
  const [fans, setFans] = useState<Fan[]>([]);
  const [pending, setPending] = useState<number | null>(null);
  const [notice, setNotice] = useState<FanNotice | null>(null);
  const inFlight = useRef(false);
  const pendingRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const result = await fetchFans();
      setFans(result.fans ?? []);
      const statusError = result.fans?.find(fan => fan.error);
      if (!result.configured) setNotice({ message: fanErrorMessage("HA_NOT_CONFIGURED"), source: "status" });
      else if (statusError?.error) setNotice({ message: fanErrorMessage(statusError.error), source: "status" });
      else setNotice(current => current?.source === "status" ? null : current);
    } catch (error) {
      setFans(items => items.map(item => ({ ...item, state: "unknown", error: "HA_STATE_UNAVAILABLE" })));
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
      setNotice({ message: fanErrorMessage(code), source: "status" });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const schedule = () => {
      if (!active) return;
      timer = setTimeout(async () => {
        await refresh();
        schedule();
      }, 8000);
    };
    const resume = () => { if (document.visibilityState === "visible") void refresh(); };
    const initialTimer = setTimeout(() => { void refresh(); }, 0);
    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      active = false;
      clearTimeout(initialTimer);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [refresh]);

  const toggle = async (fan: Fan) => {
    if (pendingRef.current !== null || fan.state === "unknown") return;
    const desiredState = fan.state === "on" ? "off" : "on";
    pendingRef.current = fan.fanId;
    setPending(fan.fanId);
    try {
      const response = await fetch(`/api/pos/fans/${fan.fanId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: desiredState }), cache: "no-store",
      });
      const result = await response.json() as { success?: boolean; code?: string; httpStatus?: number; state?: Fan["state"] };
      if (!response.ok || !result.success || result.state !== desiredState) {
        throw Object.assign(new Error("선풍기 제어 실패"), { code: result.code, httpStatus: result.httpStatus });
      }
      setFans(items => items.map(item => item.fanId === fan.fanId ? { ...item, state: result.state!, error: null } : item));
      setNotice(null);
    } catch (error) {
      setFans(items => items.map(item => item.fanId === fan.fanId ? { ...item, state: "unknown", error: "상태 확인 실패" } : item));
      const detail = error && typeof error === "object" ? error as { code?: string; httpStatus?: number } : {};
      setNotice({ message: fanErrorMessage(detail.code, detail.httpStatus), source: "command" });
    } finally {
      pendingRef.current = null;
      setPending(null);
      void refresh();
    }
  };

  return <div aria-label="선풍기 제어" className="pointer-events-none absolute inset-0 z-40" data-pos-fan-layer>
    {notice && <div aria-live="polite" className={`pointer-events-auto absolute right-2 top-2 flex max-w-[min(420px,90%)] items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold shadow-md ring-1 ${notice.source === "command" ? "bg-red-50 text-red-800 ring-red-200" : "bg-amber-50/95 text-amber-800 ring-amber-200"}`} role="status"><span>{notice.message}</span><button aria-label="알림 닫기" className="rounded px-1 text-base leading-none" onClick={() => setNotice(null)} type="button">×</button></div>}
    {fans.filter(fan => fan.isVisible).sort((a, b) => a.sortOrder - b.sortOrder).map(fan => {
      const isPending = pending === fan.fanId;
      const label = fan.state === "on" ? "켜짐" : fan.state === "off" ? "꺼짐" : "상태 미확인";
      const errorLabel = fan.error ? fanErrorMessage(fan.error) : "";
      return <button key={fan.fanId} aria-label={`${fan.name}, ${label}${isPending ? ", 처리 중" : ""}`} className={`pointer-events-auto absolute flex size-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-white bg-white/95 shadow-md ring-1 ring-slate-200 transition disabled:cursor-wait disabled:opacity-60 ${fan.state === "on" ? "shadow-green-900/20" : ""}`} disabled={isPending || fan.state === "unknown"} onClick={event => { event.preventDefault(); event.stopPropagation(); void toggle(fan); }} onPointerDown={event => event.stopPropagation()} style={{ left: `${fan.positionX}%`, top: `${fan.positionY}%` }} title={`${fan.name}: ${label}${errorLabel ? ` (${errorLabel})` : ""}`} type="button">
        <FanGlyph state={fan.state} />
        <span className="max-w-12 truncate text-[9px] font-semibold leading-none text-slate-700">{isPending ? "대기" : fan.name}</span>
      </button>;
    })}
  </div>;
}
