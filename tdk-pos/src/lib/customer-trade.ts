export type TradeEntryType =
  | "CARD_OVERPAYMENT"
  | "CARD_OVERPAYMENT_REVERSAL"
  | "PAYMENT_OVERPAYMENT"
  | "PAYMENT_OVERPAYMENT_REVERSAL"
  | "DEPOSIT"
  | "REFUND"
  | "ADJUSTMENT"
  | "CUSTOMER_PAYMENT"
  | "CUSTOMER_PAYMENT_REVERSAL";

export type CustomerTradeRow = {
  ledgerId: number;
  entryType: TradeEntryType;
  amount: number;
  balance: number;
  transactionAt: string;
  createdAt: string;
  methodCode: string | null;
  adjustmentReason: string | null;
  memo: string | null;
  paymentId: number | null;
  checkoutId: number | null;
  paymentMethodName: string | null;
  reversesLedgerId: number | null;
};

export type CustomerTradeResponse = {
  success: boolean;
  balance: number;
  entries: CustomerTradeRow[];
  message?: string;
};

export const tradeMethods = [
  { value: "CASH", label: "현금" },
  { value: "TRANSFER", label: "계좌이체" },
  { value: "CARD", label: "카드" },
  { value: "OTHER", label: "기타" },
] as const;

export const adjustmentReasons = ["금액오차", "기존자료 이관", "입금 누락 정정", "기타"] as const;

export function formatTradeBalance(amount: number) {
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${Math.abs(amount).toLocaleString("ko-KR")}`;
}

export function tradeDescription(entry: CustomerTradeRow) {
  switch (entry.entryType) {
    case "DEPOSIT":
      return `${tradeMethods.find(method => method.value === entry.methodCode)?.label ?? "기타"} 입금`;
    case "REFUND":
      return `${tradeMethods.find(method => method.value === entry.methodCode)?.label ?? "기타"} 환불`;
    case "ADJUSTMENT":
      return `잔액조정(${entry.adjustmentReason ?? "기타"})`;
    case "CARD_OVERPAYMENT":
    case "PAYMENT_OVERPAYMENT":
      return `${entry.paymentMethodName ?? "결제"} 초과결제 선불적립`;
    case "CARD_OVERPAYMENT_REVERSAL":
    case "PAYMENT_OVERPAYMENT_REVERSAL":
      return `${entry.paymentMethodName ?? "결제"} 선불적립 취소`;
    case "CUSTOMER_PAYMENT":
      return entry.memo ?? "식사 고객결제";
    case "CUSTOMER_PAYMENT_REVERSAL":
      return entry.memo ? `${entry.memo} 결제취소` : "식사 고객결제 취소";
  }
}
