import { sendPrintDocument } from "@/lib/device-printer";
import { buildAccountTransferPrintDocument, type PrintDocument } from "@/lib/print-document";

export type AccountTransferNotice = {
  storeName: string;
  receiptLogo: { width: number; height: number; pixelsBase64: string } | null;
  totalAmount: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  document?: PrintDocument;
};

export async function prepareAccountTransferNotice(input:
  | { mode: "TEST"; bankName: string; accountNumber: string; accountHolder: string }
  | { mode: "LIVE" | "MANUAL"; paymentId: number },
): Promise<AccountTransferNotice> {
  const response = await fetch("/api/account-transfer-notice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(input),
  });
  const result = await response.json() as { success?: boolean; message?: string; notice?: AccountTransferNotice; document?: PrintDocument };
  if (!response.ok || !result.success || !result.notice)
    throw new Error(result.message ?? "계좌이체 안내서를 준비하지 못했습니다.");
  return { ...result.notice, document: result.document ?? buildAccountTransferPrintDocument(result.notice) };
}
export async function printAccountTransferNotice(notice: AccountTransferNotice): Promise<void> {
  await sendPrintDocument(notice.document ?? buildAccountTransferPrintDocument(notice),
    { path: "/api/printer/account-transfer/print", payload: notice });
}
