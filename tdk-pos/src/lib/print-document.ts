// Printer-independent layout. The Device Agent only interprets these primitives.
export type PrintLogo = { width: number; height: number; pixelsBase64: string };
export type PrintCell = { value: string; width: number; align: "left" | "center" | "right" };
export type PrintCommand =
  | { type: "logo"; logo: PrintLogo }
  | { type: "text"; value: string; align: "left" | "center" | "right"; size: number; bold?: boolean }
  | { type: "row"; left?: string; right?: string; cells?: PrintCell[]; size: number; bold?: boolean }
  | { type: "line" }
  | { type: "feed"; lines: number }
  | { type: "barcode"; value: string; showHri?: boolean }
  | { type: "cut" };
export type PrintDocument = { commands: PrintCommand[] };

export type SalePrintInput = {
  storeInfo: { storeName: string; businessNumber: string; representative: string; phone: string; address: string };
  receiptLogo: PrintLogo | null;
  checkoutId: number;
  lookupCode?: string | null;
  isReprint: boolean;
  tableLabel: string;
  orderedAt: string;
  transactionAt: string;
  tableNos: string[];
  items: { itemName: string; itemType?: string; unitPrice: number; qty: number; amount: number }[];
  totalAmount: number;
  payments: {
    paymentId: number;
    method: string;
    methodCode?: string;
    amount: number;
    receivedAmount?: number;
    cashReceived?: number | null;
    cashChange?: number | null;
    prepaidCreditAmount?: number;
  }[];
  customerConfirmation?: { paymentId: number; customerName: string; amount: number; balanceAfterPayment: number; barcodeValue: string };
};

export type AccountNoticeInput = {
  storeName: string;
  receiptLogo: PrintLogo | null;
  totalAmount: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
};

const money = (amount: number) => amount.toLocaleString("ko-KR");
const row = (left: string, right: string, size = 24, bold = false): PrintCommand =>
  ({ type: "row", left, right, size, bold });
const text = (value: string, align: "left" | "center" | "right" = "center", size = 24, bold = false): PrintCommand =>
  ({ type: "text", value, align, size, bold });
const feed = (lines: number): PrintCommand => ({ type: "feed", lines });

function logoOrName(logo: PrintLogo | null, storeName: string): PrintCommand[] {
  return logo ? [{ type: "logo", logo }] : [text(storeName, "center", 40, true)];
}

function saleIdentityRows(input: SalePrintInput): PrintCommand[] {
  const store = input.storeInfo;
  return [
    row(`${store.address.trim()}${store.phone.trim() ? `(${store.phone.trim()})` : ""}`, store.businessNumber.trim()),
    row(input.transactionAt, `TNo.${input.tableNos.join(".")}`, 24),
    { type: "line" },
  ];
}

function saleHeader(input: SalePrintInput): PrintCommand[] {
  const store = input.storeInfo;
  return [
    ...logoOrName(input.receiptLogo, store.storeName),
    feed(1),
    ...(input.isReprint ? [text("[재출력]"), feed(1)] : []),
    ...saleIdentityRows(input),
  ];
}

function receiptFooter(commands: PrintCommand[], lookupCode?: string | null, showBarcodeHri = false) {
  commands.push(feed(1), { type: "line" }, text("이용해 주셔서 감사합니다.", "center", 24), feed(1));
  if (lookupCode) commands.push({ type: "barcode", value: lookupCode, showHri: showBarcodeHri }, feed(0.5));
  commands.push(feed(3), feed(2), { type: "cut" });
}

function salePaymentRows(payment: SalePrintInput["payments"][number], label = payment.method): PrintCommand[] {
  if (payment.methodCode !== "CASH") return [row(label, money(payment.amount))];
  // Historical cash payments without a tendered snapshot can only show the saved amount.
  const received = payment.cashReceived ?? payment.receivedAmount ?? payment.amount;
  const commands = [row(label, money(received))];
  if (payment.cashChange != null && payment.cashChange > 0) commands.push(row("거스름돈", money(payment.cashChange)));
  if (payment.prepaidCreditAmount != null && payment.prepaidCreditAmount > 0) {
    commands.push(row("선불금 적립", money(payment.prepaidCreditAmount)));
  }
  return commands;
}

export function buildSalePrintDocument(input: SalePrintInput): PrintDocument {
  const commands: PrintCommand[] = saleHeader(input);
  commands.push({ type: "row", cells: [
    { value: "상품명", width: 43, align: "left" },
    { value: "단가", width: 19, align: "right" },
    { value: "수량", width: 14, align: "right" },
    { value: "금액", width: 24, align: "right" },
  ], size: 24 }, { type: "line" });
  for (const item of input.items) commands.push({ type: "row", cells: [
    { value: item.itemType === "COMPONENT" ? `  └ ${item.itemName}` : item.itemName, width: 43, align: "left" },
    { value: money(item.unitPrice), width: 19, align: "right" },
    { value: String(item.qty), width: 14, align: "right" },
    { value: money(item.amount), width: 24, align: "right" },
  ], size: 24 });
  commands.push({ type: "line" }, row("총받을금액", money(input.totalAmount), 24, true));
  for (const payment of input.payments) commands.push(...salePaymentRows(payment));
  receiptFooter(commands, input.lookupCode);
  return { commands };
}

// Customer signature receipts are a separate print kind. Keep their existing
// detailed form while sharing the printer-independent row/item primitives.
export function buildCustomerConfirmationPrintDocument(input: SalePrintInput): PrintDocument {
  const customer = input.customerConfirmation;
  if (!customer) return buildSalePrintDocument(input);
  const commands: PrintCommand[] = [
    ...logoOrName(input.receiptLogo, input.storeInfo.storeName),
    text("영수증", "center", 32, true),
    feed(1),
    ...(input.isReprint ? [text("[재출력]"), feed(1)] : []),
    ...saleIdentityRows(input),
    { type: "row", cells: [
      { value: "상품명", width: 43, align: "left" }, { value: "단가", width: 19, align: "right" },
      { value: "수량", width: 14, align: "right" }, { value: "금액", width: 24, align: "right" },
    ], size: 24 }, { type: "line" }];
  for (const item of input.items) commands.push({ type: "row", cells: [
    { value: item.itemName, width: 43, align: "left" }, { value: money(item.unitPrice), width: 19, align: "right" },
    { value: String(item.qty), width: 14, align: "right" }, { value: money(item.amount), width: 24, align: "right" },
  ], size: 24 });
  commands.push({ type: "line" }, row("총 결제금액", money(input.totalAmount), 24, true), feed(0.4));
  for (const payment of input.payments) {
    const selected = customer.paymentId === payment.paymentId;
    commands.push(...salePaymentRows(payment, selected ? "고객선불금" : payment.method));
    if (selected) commands.push(row(`(${customer.customerName} 결제 후 잔액`, `${money(customer.balanceAfterPayment)})`, 24));
  }
  commands.push(feed(0.4), { type: "line" }, text("고객확인", "left"), feed(3), { type: "line" });
  commands.push(feed(1), text("이용해 주셔서 감사합니다.", "center", 24), feed(1));
  if (input.lookupCode) commands.push({ type: "barcode", value: input.lookupCode, showHri: false }, feed(0.5));
  commands.push(feed(3), feed(2), { type: "cut" });
  return { commands };
}

export function buildAccountTransferPrintDocument(input: AccountNoticeInput): PrintDocument {
  return { commands: [
    ...logoOrName(input.receiptLogo, input.storeName),
    feed(1), text("계좌이체 입금안내", "center", 32, true), feed(1),
    { type: "line" }, row("총 결제금액", `${money(input.totalAmount)}원`, 34, true), { type: "line" },
    feed(1), row(`${input.bankName}(${input.accountHolder})`, input.accountNumber, 34, true), feed(1),
    { type: "line" }, feed(0.5), text("입금 후 직원에게 알려주세요."), feed(1), feed(3), { type: "cut" },
  ] };
}
