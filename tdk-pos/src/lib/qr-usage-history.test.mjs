import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQrUsageHistoryEvents } from "./qr-usage-history.ts";

test("QR history combines access results with direct QR management audit records", () => {
  const events = buildQrUsageHistoryEvents(new Date("2026-11-01T00:00:00Z"), [
    { auditLogId: 1, actionType: "QR_TABLE_ASSIGN", createdAt: new Date("2026-11-02T00:00:00Z"), description: "Assigned QR 20261101-0001 to table 7" },
    { auditLogId: 2, actionType: "QR_ACCESS_ISSUED", createdAt: new Date("2026-11-03T00:00:00Z"), description: null },
    { auditLogId: 3, actionType: "QR_ACCESS_FAILED", createdAt: new Date("2026-11-04T00:00:00Z"), description: "reason=RETIRED_QR" },
    { auditLogId: 4, actionType: "QR_RETIRE", createdAt: new Date("2026-11-05T00:00:00Z"), description: "retired" },
  ], new Map([[3, ["RETIRED_QR_ACCESS"]]]));

  assert.deepEqual(events.map(event => event.eventType), ["QR 폐기", "QR 인증 실패", "QR 접속 · 신규 보안토큰 발급", "테이블 연결 변경", "QR 발행"]);
  assert.equal(events[1].detail, "폐기 QR 접속 시도");
  assert.deepEqual(events[1].anomalies, ["RETIRED_QR_ACCESS"]);
  assert.equal(events[3].table, "테이블 ID 7");
});
