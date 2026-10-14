import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAccountTransferPrintDocument, buildCustomerConfirmationPrintDocument, buildSalePrintDocument } from "../src/lib/print-document.ts";
import { createLookupCode, isSaleLookupCode } from "../src/lib/lookup-code.ts";
import { sendPrintDocument } from "../src/lib/device-printer.ts";

const out = process.argv[2] ?? ".print-document-checks";
await mkdir(out, { recursive: true });
const logo = { width: 16, height: 12, pixelsBase64: Buffer.alloc(16 * 12, 0).toString("base64") };
const base = {
  storeInfo: { storeName: "탑동김치찌개", businessNumber: "590-08-00080", representative: "손창호", phone: "725-7557", address: "제주시 탑동로 21" },
  receiptLogo: logo, checkoutId: 20, lookupCode: "S-A7K4M9X2Q7", isReprint: false, tableLabel: "2T", orderedAt: "2026-09-27 09:47",
  transactionAt: "2026-10-12 12:35", tableNos: ["2"],
  items: [{ itemName: "흑돼지김치찌개", unitPrice: 10000, qty: 2, amount: 20000 }], totalAmount: 20000,
};
const confirmation = balanceAfterPayment => ({ paymentId: 123, customerName: "탑동해변공연장", amount: 10000, balanceAfterPayment, barcodeValue: "P3F" });
const cases = {
  card: { ...base, payments: [{ paymentId: 1, method: "카드", amount: 20000 }] },
  cardReprint: { ...base, isReprint: true, payments: [{ paymentId: 1, method: "카드", amount: 20000 }] },
  cash: { ...base, payments: [{ paymentId: 1, method: "현금", amount: 20000 }] },
  other: { ...base, payments: [{ paymentId: 1, method: "상품권", amount: 20000 }] },
  prepaid: { ...base, payments: [{ paymentId: 1, method: "고객선불금", amount: 20000 }] },
  mixed: { ...base, payments: [{ paymentId: 1, method: "카드", amount: 10000 }, { paymentId: 2, method: "현금", amount: 10000 }] },
  cashPrepaid: { ...base, payments: [{ paymentId: 1, method: "현금", amount: 10000 }, { paymentId: 2, method: "고객선불금", amount: 10000 }] },
  triple: { ...base, payments: [{ paymentId: 1, method: "카드", amount: 5000 }, { paymentId: 2, method: "현금", amount: 5000 }, { paymentId: 3, method: "고객선불금", amount: 10000 }] },
  transfer: { ...base, payments: [{ paymentId: 1, method: "계좌이체", amount: 20000 }] },
  customerOnly: { ...base, items: [{ itemName: "흑돼지김치찌개", unitPrice: 10000, qty: 1, amount: 10000 }], totalAmount: 10000, payments: [{ paymentId: 123, method: "고객결제", amount: 10000 }], customerConfirmation: confirmation(999999) },
  cashCustomer: { ...base, payments: [{ paymentId: 1, method: "현금", amount: 10000 }, { paymentId: 123, method: "고객결제", amount: 10000 }], customerConfirmation: confirmation(999999) },
  cardCustomer: { ...base, payments: [{ paymentId: 1, method: "카드", amount: 10000 }, { paymentId: 123, method: "고객결제", amount: 10000 }], customerConfirmation: confirmation(0) },
  cardCashCustomer: { ...base, payments: [{ paymentId: 1, method: "카드", amount: 5000 }, { paymentId: 2, method: "현금", amount: 5000 }, { paymentId: 123, method: "고객결제", amount: 10000 }], customerConfirmation: confirmation(-184000) },
  noLogo: { ...base, receiptLogo: null, items: [{ itemName: "흑돼지김치찌개", unitPrice: 10000, qty: 1, amount: 10000 }], totalAmount: 10000, payments: [{ paymentId: 123, method: "고객결제", amount: 10000 }], customerConfirmation: confirmation(0) },
  historicalWithoutCode: { ...base, lookupCode: null, payments: [{ paymentId: 1, method: "카드", amount: 20000 }] },
  group: { ...base, tableNos: ["1", "2", "3"], payments: [{ paymentId: 1, method: "카드", amount: 20000 }] },
};
const issued = new Set(Array.from({ length: 1000 }, () => createLookupCode("SALE")));
assert.equal(issued.size, 1000);
assert([...issued].every(isSaleLookupCode));
assert(!isSaleLookupCode("S-0000000000"));
assert(createLookupCode("COUPON").startsWith("C-"));
for (const [name, input] of Object.entries(cases)) {
  const document = buildSalePrintDocument(input);
  assert.equal(document.commands.at(-1).type, "cut");
  assert.deepEqual(document.commands.slice(-3), [{ type: "feed", lines: 3 }, { type: "feed", lines: 2 }, { type: "cut" }]);
  assert.deepEqual(document.commands.filter(command => command.type === "barcode").map(command => command.value), input.lookupCode ? [input.lookupCode] : []);
  assert.equal(document.commands.some(command => command.type === "logo"), Boolean(input.receiptLogo));
  assert.equal(document.commands.find(command => command.type === "row" && command.left === "총받을금액")?.right, input.totalAmount.toLocaleString("ko-KR"));
  if (!input.customerConfirmation) {
    const commands = document.commands;
    assert.equal(commands[0].type, input.receiptLogo ? "logo" : "text");
    assert.deepEqual(commands[1], { type: "feed", lines: 1 });
    const addressIndex = input.isReprint ? 4 : 2;
    if (input.isReprint) {
      assert.deepEqual(commands[2], { type: "text", value: "[재출력]", align: "center", size: 24, bold: false });
      assert.deepEqual(commands[3], { type: "feed", lines: 1 });
    }
    assert.deepEqual(commands[addressIndex], { type: "row", left: `${input.storeInfo.address}(${input.storeInfo.phone})`, right: input.storeInfo.businessNumber, size: 24, bold: false });
    assert.deepEqual(commands[addressIndex + 1], { type: "row", left: input.transactionAt, right: `TNo.${input.tableNos.join(".")}`, size: 24, bold: false });
    assert(!commands.some(command => command.type === "row" && (command.left?.includes("RNO") || command.right?.includes("RNO"))));
    assert(commands.some(command => command.type === "row" && command.left === "총받을금액" && command.right === "20,000"));
    const thankYouIndex = commands.findIndex(command => command.type === "text" && command.value === "이용해 주셔서 감사합니다.");
    assert(thankYouIndex > 0);
    assert.deepEqual(commands.slice(thankYouIndex - 2, thankYouIndex), [{ type: "feed", lines: 1 }, { type: "line" }]);
    assert.deepEqual(commands[thankYouIndex], { type: "text", value: "이용해 주셔서 감사합니다.", align: "center", size: 24, bold: false });
    assert.deepEqual(commands[thankYouIndex + 1], { type: "feed", lines: 1 });
    const barcodeIndex = commands.findIndex(command => command.type === "barcode");
    if (barcodeIndex !== -1) {
      assert.deepEqual(commands[barcodeIndex], { type: "barcode", value: input.lookupCode, showHri: false });
      assert.equal(barcodeIndex, thankYouIndex + 2);
      assert.deepEqual(commands[barcodeIndex + 1], { type: "feed", lines: 0.5 });
      assert.equal(commands.at(-1).type, "cut");
    }
  }
  await writeFile(join(out, `${name}.json`), JSON.stringify(document));
}
assert.deepEqual(buildSalePrintDocument(cases.card).commands.filter(command => command.type === "barcode"),
  buildSalePrintDocument(cases.cardReprint).commands.filter(command => command.type === "barcode"));
const withComponent = buildSalePrintDocument({ ...cases.card, items: [
  ...cases.card.items, { itemName: "공기밥", itemType: "COMPONENT", unitPrice: 0, qty: 2, amount: 0 },
] });
assert(withComponent.commands.some(command => command.type === "row" && command.cells?.[0].value === "  └ 공기밥"));
const receiptPaymentRows = input => buildSalePrintDocument(input).commands
  .filter(command => command.type === "row" && ["카드", "현금", "거스름돈", "선불금 적립"].includes(command.left))
  .map(({ left, right }) => [left, right]);
const eightyThousand = { ...base, totalAmount: 80000 };
const exactCash = { paymentId: 1, method: "현금", methodCode: "CASH", amount: 80000, receivedAmount: 80000 };
const excessCash = { ...exactCash, cashReceived: 100000, cashChange: 20000 };
assert.deepEqual(receiptPaymentRows({ ...eightyThousand, payments: [exactCash] }), [["현금", "80,000"]]);
assert.deepEqual(receiptPaymentRows({ ...eightyThousand, payments: [excessCash] }), [["현금", "100,000"], ["거스름돈", "20,000"]]);
assert.deepEqual(receiptPaymentRows({ ...eightyThousand, payments: [
  { paymentId: 2, method: "카드", methodCode: "CARD", amount: 30000 },
  { ...excessCash, amount: 50000, cashChange: 50000 },
] }), [["카드", "30,000"], ["현금", "100,000"], ["거스름돈", "50,000"]]);
assert.deepEqual(receiptPaymentRows({ ...eightyThousand, payments: [
  { paymentId: 2, method: "카드", methodCode: "CARD", amount: 80000 },
] }), [["카드", "80,000"]]);
assert.deepEqual(receiptPaymentRows({ ...eightyThousand, payments: [
  { ...excessCash, cashChange: 0, prepaidCreditAmount: 20000 },
] }), [["현금", "100,000"], ["선불금 적립", "20,000"]]);
assert.deepEqual(receiptPaymentRows({ ...eightyThousand, isReprint: true, payments: [excessCash] }),
  receiptPaymentRows({ ...eightyThousand, payments: [excessCash] }));
assert.deepEqual(receiptPaymentRows({ ...eightyThousand, payments: [
  { ...exactCash, cashReceived: null, cashChange: null },
] }), [["현금", "80,000"]]);
for (const input of [cases.customerOnly, { ...cases.customerOnly, isReprint: true }, cases.noLogo, { ...cases.customerOnly, tableNos: ["6", "7"], customerConfirmation: confirmation(-24000) }, { ...cases.customerOnly, lookupCode: null }]) {
  const commands = buildCustomerConfirmationPrintDocument(input).commands;
  assert.equal(commands[0].type, input.receiptLogo ? "logo" : "text");
  assert.deepEqual(commands[1], { type: "text", value: "영수증", align: "center", size: 32, bold: true });
  assert.deepEqual(commands[2], { type: "feed", lines: 1 });
  const addressIndex = input.isReprint ? 5 : 3;
  if (input.isReprint) {
    assert.deepEqual(commands[3], { type: "text", value: "[재출력]", align: "center", size: 24, bold: false });
    assert.deepEqual(commands[4], { type: "feed", lines: 1 });
  }
  assert.deepEqual(commands[addressIndex], {
    type: "row", left: `${input.storeInfo.address}(${input.storeInfo.phone})`,
    right: input.storeInfo.businessNumber, size: 24, bold: false,
  });
  assert.deepEqual(commands[addressIndex + 1], {
    type: "row", left: input.transactionAt, right: `TNo.${input.tableNos.join(".")}`, size: 24, bold: false,
  });
  assert.equal(commands[addressIndex + 2].type, "line");
  assert.equal(commands[addressIndex + 3].cells?.[0].value, "상품명");
  assert.equal(commands[addressIndex + 4].type, "line");
  assert(commands.some(command => command.type === "text" && command.value === "고객확인"));
  const balance = commands.find(command => command.type === "row" && command.left === `(${input.customerConfirmation.customerName} 결제 후 잔액`);
  assert.equal(balance.size, commands.find(command => command.type === "row" && command.left === "고객선불금").size);
  assert.equal(balance.right, `${input.customerConfirmation.balanceAfterPayment.toLocaleString("ko-KR")})`);
  assert.deepEqual(commands.filter(command => command.type === "barcode"), input.lookupCode
    ? [{ type: "barcode", value: input.lookupCode, showHri: false }]
    : []);
  const signIndex = commands.findIndex(command => command.type === "text" && command.value === "고객확인");
  const thankYouIndex = commands.findIndex(command => command.type === "text" && command.value === "이용해 주셔서 감사합니다.");
  assert.deepEqual(commands.slice(signIndex, thankYouIndex), [
    { type: "text", value: "고객확인", align: "left", size: 24, bold: false },
    { type: "feed", lines: 3 }, { type: "line" }, { type: "feed", lines: 1 },
  ]);
  assert.deepEqual(commands[thankYouIndex + 1], { type: "feed", lines: 1 });
  if (input.lookupCode) {
    assert.deepEqual(commands[thankYouIndex + 2], { type: "barcode", value: input.lookupCode, showHri: false });
    assert.deepEqual(commands[thankYouIndex + 3], { type: "feed", lines: 0.5 });
  }
  assert.deepEqual(commands.slice(-3), [{ type: "feed", lines: 3 }, { type: "feed", lines: 2 }, { type: "cut" }]);
}
for (const input of [cases.card, cases.cash, cases.other, cases.prepaid, cases.mixed, cases.cashPrepaid, cases.triple, cases.transfer]) {
  const commands = buildSalePrintDocument(input).commands;
  assert.equal(commands[0].type, "logo");
  assert.equal(commands[2].size, 24);
  assert.equal(commands[3].size, 24);
  assert.deepEqual(commands.slice(0, 8), buildSalePrintDocument(cases.card).commands.slice(0, 8));
  assert.deepEqual(commands.find(command => command.type === "barcode"), { type: "barcode", value: base.lookupCode, showHri: false });
}
const notice = buildAccountTransferPrintDocument({ storeName: "탑동김치찌개", receiptLogo: logo, totalAmount: 9999999, bankName: "신한은행", accountHolder: "손창호", accountNumber: "010-6690-5475" });
assert.equal(notice.commands.at(-1).type, "cut");
assert.deepEqual(notice.commands.slice(-4), [{ type: "text", value: "입금 후 직원에게 알려주세요.", align: "center", size: 24, bold: false }, { type: "feed", lines: 1 }, { type: "feed", lines: 3 }, { type: "cut" }]);
assert(notice.commands.some(command => command.type === "row" && command.left === "신한은행(손창호)" && command.right === "010-6690-5475"));
await writeFile(join(out, "accountTransfer.json"), JSON.stringify(notice));
const noticeWithoutLogo = buildAccountTransferPrintDocument({ storeName: "탑동김치찌개", receiptLogo: null, totalAmount: 9999999, bankName: "신한은행", accountHolder: "손창호", accountNumber: "010-6690-5475" });
assert(noticeWithoutLogo.commands.some(command => command.type === "text" && command.value === "탑동김치찌개"));
await writeFile(join(out, "accountTransferNoLogo.json"), JSON.stringify(noticeWithoutLogo));
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
try {
  console.error = () => {};
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(sendPrintDocument(notice), /Device Agent 연결/);
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    if (paths.length === 1) throw new TypeError("Old Agent CORS preflight");
    return Response.json({ success: true });
  };
  await sendPrintDocument(notice, { path: "/api/printer/account-transfer/print", payload: {} });
  assert.deepEqual(paths, ["/api/printer/document", "/api/printer/account-transfer/print"]);
} finally { globalThis.fetch = originalFetch; console.error = originalConsoleError; }
console.log(`${Object.keys(cases).length + 2} PrintDocument fixtures passed`);
