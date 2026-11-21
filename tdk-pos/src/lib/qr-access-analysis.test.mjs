import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeQrAccessAnomalies, summarizeQrAccess } from "./qr-access-analysis.ts";

const record = (auditLogId, seconds, actionType = "QR_ACCESS_REUSED", extra = {}) => ({ auditLogId, actionType, occurredAt: new Date(seconds * 1000), ...extra });

test("QR access repetition uses a rolling five-minute window and flags once per category", () => {
  const records = Array.from({ length: 10 }, (_, index) => record(index + 1, index * 20));
  const alerts = analyzeQrAccessAnomalies(records);
  assert.equal(alerts.size, 10);
  assert.deepEqual(alerts.get(1), ["REPEATED_ACCESS"]);
  assert.equal(summarizeQrAccess(records, alerts).anomalyCount, 1);
  assert.equal(analyzeQrAccessAnomalies([...records.slice(1), record(11, 600)]).size, 0);
});

test("five failures and retired QR attempts have the requested separate findings", () => {
  const failures = Array.from({ length: 5 }, (_, index) => record(index + 1, index * 40, "QR_ACCESS_FAILED", { failureType: "QR_DISABLED" }));
  failures.push(record(6, 461, "QR_ACCESS_FAILED", { failureType: "RETIRED_QR" }));
  const alerts = analyzeQrAccessAnomalies(failures);
  assert.deepEqual(alerts.get(1), ["REPEATED_FAILURE"]);
  assert.deepEqual(alerts.get(6), ["RETIRED_QR_ACCESS"]);
  assert.equal(summarizeQrAccess(failures, alerts).failureCount, 6);
});

test("configured after-hours findings are attached without collecting client identifiers", () => {
  const alerts = analyzeQrAccessAnomalies([record(7, 1000, "QR_ACCESS_ISSUED", { outsideBusinessHours: true })]);
  assert.deepEqual(alerts.get(7), ["OUTSIDE_BUSINESS_HOURS"]);
});
