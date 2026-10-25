import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
function loadProductionModule(path, mocks) {
  const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, console, Response, Request, URL,
    require: name => name in mocks ? mocks[name] : nativeRequire(name),
  }, { filename: path });
  return module.exports;
}

const spiciness = loadProductionModule("pos-pot-spiciness.ts", {
  "./menu-choice-selection": { getMenuChoice: () => ({ options: [] }) },
});

function fixture({ completedItemId = null, readyItemId = null, taskStatus = "COOKING", missingChoice = false, failOnUpdate = false, sharedLogin = false } = {}) {
  const items = [101, 102, 103].map((menuId, index) => ({ itemId: index + 1, orderId: index + 11,
    menuId, status: index + 1 === readyItemId ? "READY" : "ORDERED" }));
  const choices = items.flatMap(item => [0, 2].filter(stage => !(missingChoice && item.menuId === 103 && stage === 0))
    .map(stage => ({ menuId: item.menuId, groupId: item.menuId + 1000, groupName: "매운맛",
      optionId: item.menuId * 10 + stage, optionName: stage === 0 ? "0.안매움" : "2.약간매운맛", priceDelta: "0.00" })));
  const savedOptions = items.map(item => ({ id: item.itemId + 100, itemId: item.itemId,
    optionId: item.menuId * 10 + 2, optionName: "2.약간매운맛", unitPrice: "0.00", groupId: item.menuId + 1000 }));
  savedOptions.push({ id: 999, itemId: 1, optionId: 900, optionName: "공기밥", unitPrice: "0.00", groupId: 900 });
  const tasks = items.map(item => ({ memberItems: JSON.stringify([{ itemId: item.itemId }]),
    status: item.itemId === completedItemId ? "DONE" : taskStatus }));
  const calls = { updates: [], audits: [], commits: 0, rollbacks: 0 };
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      if (sql.includes("FROM table_sessions s")) return [[{ status: "OPEN", tableNo: "10" }]];
      if (sql.includes("FROM order_items oi")) {
        assert.match(sql, /o\.status IN \('OPEN','ACCEPTED'\)/);
        return [items];
      }
      if (sql.includes("FROM menu_modifier_groups mmg")) return [choices];
      if (sql.includes("FROM kds_tasks k")) return [tasks];
      if (sql.includes("FROM order_item_options io")) return [savedOptions];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, values) {
      if (sql.includes("UPDATE order_item_options")) {
        if (failOnUpdate && calls.updates.length === 1) throw new Error("simulated database failure");
        calls.updates.push(values);
      } else if (sql.includes("INSERT INTO audit_logs")) calls.audits.push(values);
      else throw new Error(`Unexpected update: ${sql}`);
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.commits++; },
    async rollback() { calls.rollbacks++; },
    release() {},
  };
  const route = loadProductionModule("../app/api/table-sessions/[sessionId]/spiciness/route.ts", {
    "@/db": { pool: { getConnection: async () => connection } },
    "@/lib/auth": { getCurrentStaff: async () => sharedLogin ? null : ({ staffId: 7 }) },
    "@/lib/pos-login-mode": { getPosLoginMode: async () => sharedLogin ? "SHARED" : "STAFF" },
    "@/lib/pos-pot-spiciness": spiciness,
  });
  const change = (sessionId = 10) => route.POST(new Request(`http://localhost/api/table-sessions/${sessionId}/spiciness`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceOrderItemId: 1, modifierOptionId: 1010 }),
  }), { params: Promise.resolve({ sessionId: String(sessionId) }) });
  const check = (sourceOrderItemId = 1, sessionId = 10) => route.GET(
    new Request(`http://localhost/api/table-sessions/${sessionId}/spiciness?sourceOrderItemId=${sourceOrderItemId}`),
    { params: Promise.resolve({ sessionId: String(sessionId) }) },
  );
  return { change, check, calls, savedOptions };
}

test("one session-wide change updates each stew option and emits one KDS alert", async () => {
  const { change, calls } = fixture();
  const response = await change();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.changedCount, 3);
  assert.deepEqual(calls.updates.map(values => values[2]), [101, 102, 103]);
  assert.equal(calls.audits.length, 1);
  assert.match(calls.audits[0][4], /10번 테이블 매운맛 변경: 2\.약간매운맛 → 0\.안매움/);
  assert.equal(calls.commits, 1);
  assert.equal(calls.rollbacks, 0);
});

test("a completed stew in the same table blocks the option dialog and the whole update", async () => {
  const { change, check, calls } = fixture({ completedItemId: 3 });
  const checkResponse = await check();
  assert.equal(checkResponse.status, 409);
  assert.equal((await checkResponse.json()).message, "조리완료된 메뉴에서는 매운맛을 변경할 수 없습니다.");
  assert.equal((await change()).status, 409);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.updates.some(values => values[2] === 999), false);
  assert.equal(calls.audits.length, 0);
});

test("a completed source or ready item is rejected before the dialog opens", async () => {
  for (const options of [{ completedItemId: 1 }, { readyItemId: 2 }]) {
    const { check, change, calls } = fixture(options);
    assert.equal((await check()).status, 409);
    assert.equal((await change()).status, 409);
    assert.equal(calls.updates.length, 0);
  }
});

test("waiting and cooking stews pass the read-only check", async () => {
  for (const taskStatus of ["WAITING", "COOKING"]) {
    const { check, calls } = fixture({ taskStatus });
    assert.equal((await check()).status, 200);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.audits.length, 0);
    assert.equal(calls.commits, 0);
  }
});

test("shared POS login can change options without a staff row", async () => {
  const { change, calls } = fixture({ sharedLogin: true });
  assert.equal((await change()).status, 200);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0][0], null);
});

test("missing matching choice aborts the entire table update", async () => {
  const { change, calls } = fixture({ missingChoice: true });
  const response = await change();
  assert.equal(response.status, 409);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.audits.length, 0);
  assert.equal(calls.rollbacks, 1);
});

test("database failure rolls back all option changes and the alert", async () => {
  const { change, calls } = fixture({ failOnUpdate: true });
  const response = await change();
  assert.equal(response.status, 500);
  assert.equal(calls.commits, 0);
  assert.equal(calls.rollbacks, 1);
  assert.equal(calls.audits.length, 0);
});
