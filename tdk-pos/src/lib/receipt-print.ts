import { sendPrintDocument } from "@/lib/device-printer";
import type { PrintDocument } from "@/lib/print-document";

export async function printReceipt(target: { checkoutId?: number; tableId?: number; customerPaymentId?: number; isReprint?: boolean }): Promise<void> {
  let prepared: Response;
  let result: { success?: boolean; message?: string; checkoutId?: number; receipt?: Record<string, unknown>; document?: PrintDocument };
  try {
    prepared = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(target),
    });
    result = await prepared.json();
  } catch (error) {
    console.error("Receipt preparation request failed", error);
    throw new Error("영수증 정보를 준비할 수 없습니다.");
  }
  if (!prepared.ok || !result.success || !result.receipt)
    throw new Error(result.message ?? "영수증 정보를 준비할 수 없습니다.");

  if (!result.document) throw new Error("영수증 인쇄 문서가 준비되지 않았습니다.");
  await sendPrintDocument(result.document, { path: "/api/printer/receipt", payload: result.receipt });
  if (target.customerPaymentId === undefined && Number.isSafeInteger(result.checkoutId)) {
    try {
      const recorded = await fetch("/api/sales/print-history", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ checkoutId: result.checkoutId, printKind: "GENERAL" }),
      });
      if (!recorded.ok) throw new Error(`HTTP ${recorded.status}`);
    } catch (error) {
      console.warn("General receipt was sent but its print history could not be recorded", error);
    }
  }
}
