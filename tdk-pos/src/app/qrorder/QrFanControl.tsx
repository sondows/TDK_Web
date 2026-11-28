"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readJsonResponse } from "@/lib/api-response";

type FanStatus = { success: boolean; available?: boolean; name?: string; state?: "on" | "off" | "unknown"; message?: string };

export default function QrFanControl({ disabled }: { disabled: boolean }) {
  const [fan, setFan] = useState<FanStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const statusRequest = useRef<AbortController | null>(null);
  const commandPending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const refresh = useCallback(async () => {
    if (commandPending.current || statusRequest.current) return;
    const controller = new AbortController();
    statusRequest.current = controller;
    try {
      const response = await fetch("/api/qr/fan", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const data = await readJsonResponse(response, response.url, "선풍기 상태") as FanStatus;
      if (controller.signal.aborted) return;
      if (!response.ok || !data.success) throw new Error(data.message ?? "선풍기 연결을 확인해 주세요.");
      setFan(data);
    } catch {
      if (!controller.signal.aborted) setFan(null);
    } finally {
      if (statusRequest.current === controller) statusRequest.current = null;
    }
  }, []);
  const dialogOpen = open && !disabled;
  useEffect(() => {
    if (disabled) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, dialogOpen ? 5000 : 15000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      statusRequest.current?.abort();
      statusRequest.current = null;
    };
  }, [disabled, dialogOpen, refresh]);
  useEffect(() => {
    if (!dialogOpen) return;
    const button = trigger.current;
    closeButton.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      button?.focus({ preventScroll: true });
    };
  }, [dialogOpen]);

  const command = async (state: "on" | "off") => {
    if (commandPending.current) return;
    commandPending.current = true;
    statusRequest.current?.abort();
    statusRequest.current = null;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/qr/fan", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
      const data = await readJsonResponse(response, response.url, "선풍기 제어") as FanStatus;
      if (!response.ok || !data.success || (data.state !== "on" && data.state !== "off")) {
        throw new Error(data.message ?? "선풍기 연결을 확인해 주세요.");
      }
      setFan(current => current ? { ...current, state: data.state } : current);
    } catch (reason) {
      setFan(current => current ? { ...current, state: "unknown" } : current);
      setError(reason instanceof Error ? reason.message : "선풍기 연결을 확인해 주세요.");
    } finally {
      commandPending.current = false;
      setBusy(false);
    }
  };

  const fanUnavailable = fan?.success && !fan.available;
  const stateLabel = fan?.state === "on" ? "켜짐" : fan?.state === "off" ? "꺼짐" : "상태 확인 불가";
  const statusLabel = disabled ? "" : fanUnavailable ? "미지정" : fan?.state === "on" ? "ON" : fan?.state === "off" ? "OFF" : "상태 확인 불가";
  return <>
    <button aria-label={`선풍기${disabled ? "" : ` ${fanUnavailable ? "미지정" : stateLabel}`}`} aria-haspopup="dialog" aria-expanded={dialogOpen}
      className="flex min-h-[4.5rem] min-w-0 flex-col items-center justify-center gap-0.5 font-normal text-blue-700 transition-colors aria-expanded:bg-blue-50 active:bg-[#E5E7EB] disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500"
      disabled={disabled || !fan?.available} onClick={() => { setOpen(true); setError(""); }} ref={trigger} type="button">
      <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M12 10c-2-5-1-8 1-8 3 0 4 4 2 8M14 12c5-2 8-1 8 1 0 3-4 4-8 2M12 14c2 5 1 8-1 8-3 0-4-4-2-8M10 12c-5 2-8 1-8-1 0-3 4-4 8-2"/></svg>
      <span className="text-[11px] leading-tight">선풍기</span>
      {statusLabel && <span className="max-w-full truncate text-[10px] leading-none">{statusLabel}</span>}
    </button>
    {dialogOpen && createPortal(<div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
      <section aria-modal="true" aria-labelledby="qr-fan-title" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="dialog">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold" id="qr-fan-title">{fan?.name ?? "선풍기"}</h2><button aria-label="닫기" className="min-h-11 min-w-11 text-2xl" onClick={() => setOpen(false)} ref={closeButton} type="button">×</button></div>
        <p className="mt-3 text-sm text-slate-600" role="status">현재 상태: {fanUnavailable ? "미지정" : stateLabel}</p>
        {(error || (!fanUnavailable && stateLabel === "상태 확인 불가")) && <p className="mt-2 text-sm text-red-700" role="alert">{error || "선풍기 연결을 확인해 주세요."}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2"><button className="min-h-12 rounded-xl bg-blue-700 font-bold text-white disabled:opacity-50" disabled={busy || !fan?.available} onClick={() => void command("on")} type="button">켜기</button><button className="min-h-12 rounded-xl border border-slate-300 font-bold text-slate-700 disabled:opacity-50" disabled={busy || !fan?.available} onClick={() => void command("off")} type="button">끄기</button></div>
      </section>
    </div>, document.body)}
  </>;
}
