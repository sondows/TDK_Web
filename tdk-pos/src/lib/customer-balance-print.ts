import type { CustomerTradeRow } from "@/lib/customer-trade";
import type { PrintCommand, PrintDocument } from "@/lib/print-document";

const printableWidth = 488;
const fontSize = 24;
const maxCommands = 250;

export type PrinterTextMeasure = (value: string) => number;

function dateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new Error("거래 날짜 형식을 확인할 수 없습니다.");
  return `${match[1].slice(-2)}/${match[2]}/${match[3]}`;
}

function cleanDescription(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function splitGraphemes(value: string) {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(value)].map(part => part.segment);
  }
  return Array.from(value);
}

function clippedDescription(value: string, width: number, measure: PrinterTextMeasure) {
  if (measure(value) <= width) return value;
  const suffix = "..";
  let result = "";
  for (const part of splitGraphemes(value)) {
    if (measure(`${result}${part}${suffix}`) > width) break;
    result += part;
  }
  if (!result) {
    if (measure(suffix) > width) throw new Error("표준 글꼴과 금액 폭에서 거래 내용을 한 줄로 배치할 수 없습니다.");
    return suffix;
  }
  return `${result}${suffix}`;
}

function amountLabel(amount: number) {
  if (!Number.isFinite(amount)) throw new Error("거래 금액을 확인할 수 없습니다.");
  return amount.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function toColumnPercent(pixelWidth: number) {
  return Math.ceil(pixelWidth * 100 / printableWidth);
}

function maxWidth(values: string[], measure: PrinterTextMeasure) {
  return values.reduce((maximum, value) => Math.max(maximum, measure(value)), 0);
}

function allocateColumns(rows: readonly CustomerTradeRow[], measure: PrinterTextMeasure): { date: number; amount: number; balance: number } {
  const dates = rows.map(row => dateLabel(row.transactionAt));
  const amounts = rows.map(row => amountLabel(row.amount));
  const balances = rows.map(row => amountLabel(row.balance));
  // Reserve standard-font date and number columns first; the first line's description gets the remaining width.
  // GDI's DrawString can be a little wider than browser canvas metrics for Malgun Gothic.
  const dateWidth = toColumnPercent(Math.ceil(maxWidth(dates, measure) + 20));
  const amountWidth = toColumnPercent(Math.ceil(maxWidth(amounts.map(value => `${value}  `), measure) + 20));
  const balanceWidth = toColumnPercent(Math.ceil(maxWidth(balances, measure) + 20));
  const spare = 100 - dateWidth - amountWidth - balanceWidth;
  if (dateWidth < 10 || amountWidth < 10 || balanceWidth < 10 || spare < 0) {
    throw new Error("날짜와 금액이 일반 영수증 글자 크기로 한 줄에 들어가지 않습니다.");
  }
  return { date: dateWidth, amount: amountWidth + Math.floor(spare / 2), balance: balanceWidth + Math.ceil(spare / 2) };
}

function commandsForEntry(
  row: CustomerTradeRow,
  columns: { date: number; amount: number; balance: number },
  measure: PrinterTextMeasure,
  describe: (row: CustomerTradeRow) => string,
): [PrintCommand, PrintCommand] {
  const date = dateLabel(row.transactionAt);
  const amount = amountLabel(row.amount);
  const balance = amountLabel(row.balance);
  const description = cleanDescription(describe(row));
  const datePixels = Math.floor(printableWidth * columns.date / 100);
  const descriptionColumn = 100 - columns.date;
  const descriptionPixels = Math.floor(printableWidth * descriptionColumn / 100);
  const amountPixels = Math.floor(printableWidth * columns.amount / 100);
  const balancePixels = Math.floor(printableWidth * columns.balance / 100);
  const descriptionBudget = descriptionPixels - measure("  ") - 4;
  if (measure(date) + 3 > datePixels || measure(`${amount}  `) + 3 > amountPixels || measure(balance) + 3 > balancePixels) {
    throw new Error("날짜 또는 금액이 일반 영수증 글자 크기로 한 줄에 들어가지 않습니다.");
  }
  if (measure("..") > descriptionBudget) {
    throw new Error("표준 글꼴과 금액 폭에서 거래 내용을 한 줄로 배치할 수 없습니다.");
  }
  const displayDescription = clippedDescription(description, descriptionBudget, measure);
  const firstLine = [
    { value: date, width: columns.date, align: "left" as const },
    { value: `  ${displayDescription}`, width: descriptionColumn, align: "left" as const },
  ];
  const secondLine = [
    { value: " ", width: columns.date, align: "left" as const },
    { value: `${amount}  `, width: columns.amount, align: "right" as const },
    { value: balance, width: columns.balance, align: "right" as const },
  ];
  // Reject any cell that could wrap in the Device Agent's GDI renderer.
  if (firstLine.some((cell, index) => measure(cell.value) > Math.floor(printableWidth * [columns.date, descriptionColumn][index] / 100) - 2) ||
      secondLine.some((cell, index) => measure(cell.value) > Math.floor(printableWidth * [columns.date, columns.amount, columns.balance][index] / 100) - 2)) {
    throw new Error("거래 행의 글자 폭을 일반 영수증 한 줄에 맞추지 못했습니다.");
  }
  return [
    { type: "row", cells: firstLine, size: fontSize },
    { type: "row", cells: secondLine, size: fontSize },
  ];
}

export function buildCustomerBalancePrintDocuments(
  rows: readonly CustomerTradeRow[],
  measure: PrinterTextMeasure,
  describe: (row: CustomerTradeRow) => string,
  header: readonly PrintCommand[],
  footer: readonly PrintCommand[],
): PrintDocument[] {
  if (!Number.isFinite(measure("0")) || measure("0") <= 0) throw new Error("프린터 글꼴 폭을 측정할 수 없습니다.");
  if (rows.length === 0) throw new Error("출력할 거래 내역이 없습니다.");

  const columns = allocateColumns(rows, measure);
  const tradeRows = rows.map(row => commandsForEntry(row, columns, measure, describe));
  const commands = [...header, ...tradeRows.flat(), ...footer];
  if (commands.length > maxCommands) {
    throw new Error(`거래내역 ${rows.length}건은 기존 Device Agent 단일 인쇄 요청 한도(${maxCommands}개 명령)를 초과합니다. 거래를 나누어 인쇄하지 않았습니다.`);
  }
  return [{ commands }];
}
