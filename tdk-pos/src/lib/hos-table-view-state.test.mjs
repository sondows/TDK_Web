import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowHosEmptyTableState } from "./hos-table-view-state.ts";

test("an empty-table message appears only after a successful empty response", () => {
  assert.equal(shouldShowHosEmptyTableState(0, false, ""), true);
  assert.equal(shouldShowHosEmptyTableState(0, true, ""), false);
  assert.equal(shouldShowHosEmptyTableState(0, false, "테이블 정보를 불러오지 못했습니다."), false);
  assert.equal(shouldShowHosEmptyTableState(12, false, ""), false);
});
