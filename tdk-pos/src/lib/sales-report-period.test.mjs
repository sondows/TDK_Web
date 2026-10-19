import assert from "node:assert/strict";
import test from "node:test";
import { defaultSalesReportRange, salesReportPresets } from "./sales-report-period.ts";

const range = (presets, id) => presets.find(preset => preset.id === id)?.range;

test("2026-10-18 defaults and rolling ranges include the current date", () => {
  const today = "2026-10-18";
  assert.deepEqual(defaultSalesReportRange("yearly", today), { startDate: "2020-01-01", endDate: "2026-12-31" });
  assert.deepEqual(defaultSalesReportRange("monthly", today), { startDate: "2026-01-01", endDate: "2026-10-31" });
  assert.deepEqual(defaultSalesReportRange("daily", today), { startDate: "2026-10-01", endDate: today });
  assert.deepEqual(range(salesReportPresets("yearly", today, "2017-09-18"), "recent"), { startDate: "2017-01-01", endDate: "2026-12-31" });
  assert.deepEqual(range(salesReportPresets("monthly", today, "2017-09-18"), "recent"), { startDate: "2025-11-01", endDate: "2026-10-31" });
  assert.deepEqual(range(salesReportPresets("daily", today, "2017-09-18"), "recent"), { startDate: "2026-09-19", endDate: today });
});

test("2031 January defaults, labels, and rolling ranges cross year boundaries", () => {
  const today = "2031-01-05";
  assert.deepEqual(defaultSalesReportRange("yearly", today), { startDate: "2030-01-01", endDate: "2031-12-31" });
  assert.deepEqual(defaultSalesReportRange("monthly", today), { startDate: "2031-01-01", endDate: "2031-01-31" });
  assert.deepEqual(defaultSalesReportRange("daily", today), { startDate: "2031-01-01", endDate: today });
  assert.equal(salesReportPresets("yearly", today, null)[2].label, "2030년대");
  assert.equal(salesReportPresets("monthly", today, null)[2].label, "2031년");
  assert.equal(salesReportPresets("daily", today, null)[2].label, "1월");
  assert.deepEqual(range(salesReportPresets("yearly", today, null), "recent"), { startDate: "2022-01-01", endDate: "2031-12-31" });
  assert.deepEqual(range(salesReportPresets("monthly", today, null), "recent"), { startDate: "2030-02-01", endDate: "2031-01-31" });
});

test("decade label changes on 2030-01-01 and whole ranges use the actual earliest date", () => {
  assert.equal(salesReportPresets("yearly", "2029-12-31", null)[2].label, "2020년대");
  assert.equal(salesReportPresets("yearly", "2030-01-01", null)[2].label, "2030년대");
  assert.deepEqual(range(salesReportPresets("yearly", "2031-01-05", "2017-09-18"), "all"), { startDate: "2017-01-01", endDate: "2031-12-31" });
  assert.deepEqual(range(salesReportPresets("monthly", "2031-01-05", "2017-09-18"), "all"), { startDate: "2017-09-01", endDate: "2031-01-31" });
  assert.deepEqual(range(salesReportPresets("daily", "2031-01-05", "2017-09-18"), "all"), { startDate: "2017-09-18", endDate: "2031-01-05" });
  assert.equal(range(salesReportPresets("daily", "2031-01-05", null), "all"), null);
});

test("detail presets include today and rolling calendar days across month boundaries", () => {
  const today = "2026-10-19";
  const presets = salesReportPresets("detail", today, null);
  assert.deepEqual(presets.map(preset => preset.label), ["최근 30일", "최근 7일", "당일"]);
  assert.deepEqual(defaultSalesReportRange("detail", today), { startDate: today, endDate: today });
  assert.deepEqual(range(presets, "today"), { startDate: today, endDate: today });
  assert.deepEqual(range(presets, "recent7"), { startDate: "2026-10-13", endDate: today });
  assert.deepEqual(range(presets, "recent"), { startDate: "2026-09-20", endDate: today });
  assert.deepEqual(range(salesReportPresets("detail", "2027-01-03", null), "recent7"),
    { startDate: "2026-12-28", endDate: "2027-01-03" });
  assert.deepEqual(range(salesReportPresets("detail", "2027-01-03", null), "recent"),
    { startDate: "2026-12-05", endDate: "2027-01-03" });
});
