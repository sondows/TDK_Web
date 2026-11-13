export const QR_CART_EVENT_OUTBOX_KEY = "tdkon:qr-cart-events:v1";
export const QR_CART_EVENT_BATCH_SIZE = 50;
export const QR_CART_EVENT_OUTBOX_LIMIT = 500;

export type QrCartEventSource = "FRONT" | "WAITING" | "TABLE";
export type QrCartEventType = "MENU_VIEW" | "ADD" | "INCREASE" | "DECREASE" | "REMOVE";

export type QrCartAnalyticsEvent = {
  clientEventId: string;
  source: QrCartEventSource;
  eventType: QrCartEventType;
  menuId: number;
  optionIds: number[];
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  occurredAt: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function qrCartEventSourceFromSearch(search: string): QrCartEventSource {
  const value = new URLSearchParams(search).get("source")?.toLowerCase();
  if (value === "waiting") return "WAITING";
  if (value === "table") return "TABLE";
  return "FRONT";
}

export function isQrCartAnalyticsEvent(value: unknown): value is QrCartAnalyticsEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<QrCartAnalyticsEvent>;
  if (typeof event.clientEventId !== "string" || !uuidPattern.test(event.clientEventId) ||
    (event.source !== "FRONT" && event.source !== "WAITING" && event.source !== "TABLE") ||
    (event.eventType !== "MENU_VIEW" && event.eventType !== "ADD" && event.eventType !== "INCREASE" && event.eventType !== "DECREASE" && event.eventType !== "REMOVE") ||
    !Number.isSafeInteger(event.menuId) || (event.menuId ?? 0) <= 0 ||
    !Array.isArray(event.optionIds) || event.optionIds.length > 30 ||
    event.optionIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(event.optionIds).size !== event.optionIds.length ||
    !Number.isInteger(event.quantityBefore) || (event.quantityBefore ?? -1) < 0 || (event.quantityBefore ?? 100) > 99 ||
    !Number.isInteger(event.quantityAfter) || (event.quantityAfter ?? -1) < 0 || (event.quantityAfter ?? 100) > 99 ||
    !Number.isInteger(event.quantityDelta) || (event.eventType !== "MENU_VIEW" && (event.quantityDelta ?? 0) === 0) || Math.abs(event.quantityDelta ?? 0) > 99 ||
    typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt))) return false;

  const before = event.quantityBefore!;
  const delta = event.quantityDelta!;
  const after = event.quantityAfter!;
  if (event.eventType === "MENU_VIEW") return before === 0 && delta === 0 && after === 0 && event.optionIds.length === 0;
  if (before + delta !== after) return false;
  if ((event.eventType === "ADD" || event.eventType === "INCREASE") && delta <= 0) return false;
  if (event.eventType === "DECREASE" && delta >= 0) return false;
  if (event.eventType === "REMOVE" && (delta >= 0 || after !== 0)) return false;
  if (event.eventType !== "ADD" && before === 0) return false;
  return true;
}

export function normalizeQrCartEventOutbox(value: unknown): QrCartAnalyticsEvent[] {
  if (!Array.isArray(value)) return [];
  const events: QrCartAnalyticsEvent[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isQrCartAnalyticsEvent(candidate) || ids.has(candidate.clientEventId)) continue;
    ids.add(candidate.clientEventId);
    events.push({ ...candidate, optionIds: [...candidate.optionIds].sort((a, b) => a - b) });
  }
  return events.slice(-QR_CART_EVENT_OUTBOX_LIMIT);
}

export function appendQrCartEvents(existing: unknown, additions: QrCartAnalyticsEvent[]): QrCartAnalyticsEvent[] {
  return normalizeQrCartEventOutbox([...normalizeQrCartEventOutbox(existing), ...additions]);
}

export function acknowledgeQrCartEvents(existing: unknown, acknowledgedIds: readonly string[]): QrCartAnalyticsEvent[] {
  const acknowledged = new Set(acknowledgedIds);
  return normalizeQrCartEventOutbox(existing).filter(event => !acknowledged.has(event.clientEventId));
}
