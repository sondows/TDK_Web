import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerBalancePrintDocuments } from "./customer-balance-print.ts";

function printerMeasure(value) {
  let width = 0;
  for (const character of value) {
    if (/\p{Script=Hangul}/u.test(character)) width += 24;
    else if (/[0-9A-Za-z]/.test(character)) width += 13.2;
    else if (character === " ") width += 6.6;
    else if (character === "," || character === "/" || character === ".") width += 6.6;
    else if (character === "-") width += 8;
    else width += 12;
  }
  return width;
}

function ledgerRow({ date = "2026-01-01T12:34:00", description = "계좌입금", amount = 10000, balance = 10000 } = {}) {
  return {
    ledgerId: 1, entryType: "DEPOSIT", amount, balance, transactionAt: date, createdAt: date,
    methodCode: "TRANSFER", adjustmentReason: null, memo: null, paymentId: null, checkoutId: null,
    paymentMethodName: null, reversesLedgerId: null, description,
  };
}

const header = {
  commands: Array.from({ length: 7 }, () => ({ type: "text", value: "receipt header", align: "center", size: 24 })),
};

function printDocuments(rows, currentBalance = 96000) {
  const footer = [
    { type: "line" },
    { type: "row", left: "현재 잔액", right: currentBalance.toLocaleString("ko-KR"), size: 24, bold: true },
    { type: "feed", lines: 2 }, { type: "cut" },
  ];
  return buildCustomerBalancePrintDocuments(rows, printerMeasure, row => row.description, header.commands, footer);
}

test("24px receipt body prints date, description, signed money, and balance as one line per trade", () => {
  const [document] = printDocuments([
    ledgerRow({ description: "흑돼지김치찌개4", amount: -20000, balance: 16000 }),
    ledgerRow({ date: "2026-01-02T15:40:00", description: "계좌입금", amount: 30000, balance: 46000 }),
    ledgerRow({ date: "2026-01-03T08:00:00", description: "Card refund", amount: -10000, balance: -10000 }),
  ]);
  const rows = document.commands.filter(command => command.type === "row" && command.cells);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map(row => row.cells.length), [2, 3, 2, 3, 2, 3]);
  assert.equal(rows[0].cells[0].value, "26/01/01");
  assert.equal(rows[0].cells[1].value.startsWith("  흑돼지김치찌개4"), true);
  assert.equal(rows[1].cells[0].value, " ");
  assert.equal(rows[1].cells[1].value, "-20,000  ");
  assert.equal(rows[1].cells[2].value, "16,000");
  assert.equal(rows[3].cells[1].value, "30,000  ");
  assert.equal(rows[5].cells[1].value, "-10,000  ");
  assert.equal(rows[5].cells[2].value, "-10,000");
  for (const row of rows) {
    assert.equal(row.size, 24);
    assert.equal(row.cells.reduce((sum, cell) => sum + cell.width, 0), 100);
    assert.ok(row.cells.every(cell => !/[\r\n]/.test(cell.value)));
    row.cells.forEach(cell => assert.ok(printerMeasure(cell.value) <= Math.floor(488 * cell.width / 100) - 2));
  }
  assert.equal(document.commands.at(-4).type, "line");
  const currentBalance = document.commands.find(command => command.type === "row" && command.left === "현재 잔액");
  assert.equal(currentBalance.right, "96,000");
  assert.equal(currentBalance.size, 24);
  assert.equal(currentBalance.bold, true);
  assert.deepEqual(document.commands.slice(-3).map(command => command.type), ["row", "feed", "cut"]);
  assert.equal(document.commands.at(-2).lines, 2);
  assert.equal(document.commands.at(-1).type, "cut");
});

test("long Korean and mixed descriptions are clipped at grapheme boundaries without line breaks", () => {
  const [document] = printDocuments([
    ledgerRow({ description: "흑돼지김치찌개추가 Extra topping, takeaway", amount: -9999999, balance: -9999999 }),
    ledgerRow({ date: "2026-01-02T00:00:00", description: "흑돼지김치찌개4", amount: 9999999, balance: 9999999 }),
  ]);
  const firstLines = document.commands.filter(command => command.type === "row" && command.cells?.length === 2);
  assert.equal(firstLines.length, 2);
  assert.ok(firstLines[0].cells[1].value.trim().endsWith(".."));
  assert.equal(firstLines[1].cells[1].value.trim(), "흑돼지김치찌개4");
  for (const row of firstLines) {
    assert.equal(row.cells[1].value.includes("\n"), false);
    assert.equal(row.size, 24);
  }
});

test("maximum transaction values and negative current balance retain commas and signs", () => {
  const [document] = printDocuments([ledgerRow({ amount: 9999999, balance: -9999999 })], -9999999);
  const rows = document.commands.filter(command => command.type === "row" && command.cells);
  assert.equal(rows[1].cells[1].value, "9,999,999  ");
  assert.equal(rows[1].cells[2].value, "-9,999,999");
  assert.equal(document.commands.find(command => command.type === "row" && command.left === "현재 잔액").right, "-9,999,999");
});

test("a single document includes every trade, current balance, two feeds, and one final cut", () => {
  const count = 119;
  const [document] = printDocuments(Array.from({ length: count }, (_, index) => ledgerRow({
    date: `2026-01-${String(index % 28 + 1).padStart(2, "0")}T12:00:00`, description: `거래-${index + 1}`,
  })));
  assert.equal(document.commands.length, 249);
  const tradeRows = document.commands.filter(command => command.type === "row" && command.cells);
  assert.equal(tradeRows.length, count * 2);
  assert.ok(tradeRows.at(-2).cells[1].value.includes(`거래-${count}`));
  assert.deepEqual(tradeRows.slice(-2).map(command => command.cells.length), [2, 3]);
  assert.equal(document.commands.filter(command => command.type === "cut").length, 1);
  assert.deepEqual(document.commands.slice(-3).map(command => command.type), ["row", "feed", "cut"]);
  assert.equal(document.commands.at(-2).lines, 2);
});

test("a ledger over the existing Agent single-request limit is rejected without splitting", () => {
  for (const count of [120, 500]) {
    assert.throws(() => printDocuments(Array.from({ length: count }, (_, index) => ledgerRow({
      date: `2026-01-${String(index % 28 + 1).padStart(2, "0")}T12:00:00`, description: `거래-${index + 1}`,
    }))), /단일 인쇄 요청 한도\(250개 명령\)를 초과합니다/);
  }
});

test("empty, invalid date, invalid width, or non-finite amounts are rejected", () => {
  assert.throws(() => printDocuments([]), /출력할 거래 내역/);
  assert.throws(() => buildCustomerBalancePrintDocuments([ledgerRow()], () => 0, row => row.description, header.commands, []), /글꼴 폭/);
  assert.throws(() => printDocuments([ledgerRow({ date: "invalid" })]), /날짜 형식/);
  assert.throws(() => printDocuments([ledgerRow({ amount: Number.NaN })]), /거래 금액/);
});
