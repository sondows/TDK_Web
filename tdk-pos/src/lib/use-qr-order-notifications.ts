"use client";

import { useEffect, useRef, useState } from "react";
import { mergeQrOrderNotifications, type QrOrderNotification } from "@/lib/qr-order-notification-model";
import type { QrOrderTableListItem } from "@/lib/qr-orders-list-model";
import { parseJsonResponse } from "@/lib/api-response";

type Snapshot = { events: QrOrderNotification[]; qrOrderTables: QrOrderTableListItem[] };

export function useQrOrderNotifications(initialCursor: number) {
  const cursorRef = useRef(Math.max(0, Math.floor(initialCursor)));
  const [snapshot, setSnapshot] = useState<Snapshot>({ events: [], qrOrderTables: [] });

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/qr/staff-order-notifications?afterId=${cursorRef.current}`, {
          cache: "no-store", signal: controller.signal,
        });
        const result = await parseJsonResponse<{ success?: boolean; cursor?: number; events?: QrOrderNotification[];
          qrOrderTables?: QrOrderTableListItem[]; message?: string }>(
          response, "/api/qr/staff-order-notifications", "QR order notification polling", "GET",
        );
        if (!response.ok || !result.success || !Number.isSafeInteger(result.cursor) || !Array.isArray(result.events)
          || !Array.isArray(result.qrOrderTables)) throw new Error(result.message ?? "QR 주문 알림을 불러오지 못했습니다.");
        if (!active) return;
        cursorRef.current = Math.max(cursorRef.current, Number(result.cursor));
        setSnapshot(current => ({
          events: mergeQrOrderNotifications(current.events, result.events!),
          qrOrderTables: result.qrOrderTables!,
        }));
      } catch {
        // Retain the current cursor so the next poll retries any unseen order IDs.
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, []);

  const dismiss = (qrOrderId: number) => setSnapshot(current => ({ ...current,
    events: current.events.filter(event => event.qrOrderId !== qrOrderId) }));
  return { ...snapshot, dismiss };
}
