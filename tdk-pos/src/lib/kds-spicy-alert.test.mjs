import assert from "node:assert/strict";
import test from "node:test";
import { latestKdsSpicyAlert } from "./kds-spicy-alert.ts";

const alert = (id, sessionId, createdAtMs, after) => ({
  id, sessionId, createdAtMs,
  message: `${sessionId}번 테이블 매운맛 변경: 2.약간매운맛 → ${after}`,
});

test("only the changed table sees its latest taste inside the ten-second window", () => {
  const alerts = [alert(1, 10, 1000, "0.안매움"), alert(2, 11, 2000, "1.순한맛"),
    alert(3, 10, 3000, "3.매운맛")];
  assert.equal(latestKdsSpicyAlert(alerts, 10, 3000), "매운맛 변경: 3.매운맛");
  assert.equal(latestKdsSpicyAlert(alerts, 11, 3000), "매운맛 변경: 1.순한맛");
  assert.equal(latestKdsSpicyAlert(alerts, 12, 3000), null);
  assert.equal(latestKdsSpicyAlert(alerts, 10, 12999), "매운맛 변경: 3.매운맛");
  assert.equal(latestKdsSpicyAlert(alerts, 10, 13000), null);
});
