/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  module._compile(output, filename);
};
const { inheritedPotSpicyChoice, inheritedTableSpicyChoice, synchronizePendingPotSpiciness, hasConsistentPotSpiciness, posPotKey } = require("./pos-pot-spiciness.ts");

const menus = [
  { menuId: 1, kdsKind: "POT", kdsGroupKey: "STEW" },
  { menuId: 2, kdsKind: "POT", kdsGroupKey: "STEW" },
  { menuId: 3, kdsKind: "POT", kdsGroupKey: "STEW" },
  { menuId: 4, kdsKind: "POT", kdsGroupKey: "SEPARATE" },
  { menuId: 5, kdsKind: "SOLO", kdsGroupKey: "STEW" },
];
const modifiers = menus.flatMap(menu => [0, 1, 2].map(stage => ({
  menuId: menu.menuId, modifierGroupId: menu.menuId * 10, groupName: "매운맛",
  modifierOptionId: menu.menuId * 100 + stage, optionName: `${stage}.매운맛`,
  optionSortOrder: stage, choiceDefaultOptionId: menu.menuId * 100 + 1,
  priceDelta: "0.00",
})));
const option = (menuId, stage) => ({ modifierGroupId: menuId * 10, modifierOptionId: menuId * 100 + stage,
  optionName: `${stage}.매운맛`, priceDelta: 0, qty: 1 });
const cartItem = (menuId, stage) => ({ menuId, unitPrice: 10_000, qty: 1, options: [option(menuId, stage)] });

test("0, 1, and 2 inherit on opening the next pot menu, including a third menu", () => {
  for (const stage of [0, 1, 2]) {
    const cart = [cartItem(1, stage), cartItem(2, stage)];
    assert.equal(inheritedPotSpicyChoice(menus[1], cart.slice(0, 1), menus, modifiers)?.modifierOptionId, 200 + stage);
    assert.equal(inheritedPotSpicyChoice(menus[2], cart, menus, modifiers)?.modifierOptionId, 300 + stage);
  }
});

test("changing a pot taste updates all matching pending menus and preserves other options", () => {
  const addon = { modifierGroupId: 99, modifierOptionId: 999, optionName: "두부추가", priceDelta: 0, qty: 2 };
  const cart = [{ ...cartItem(1, 0), options: [option(1, 0), addon] }, cartItem(2, 0), cartItem(3, 0), cartItem(4, 2), cartItem(5, 2)];
  const updated = synchronizePendingPotSpiciness(cart, menus[1], "1.매운맛", menus, modifiers);
  assert.deepEqual(updated.slice(0, 3).map(item => item.options[0].modifierOptionId), [101, 201, 301]);
  assert.equal(updated[0].options[1], addon);
  assert.equal(updated[3], cart[3]);
  assert.equal(updated[4], cart[4]);
  assert.deepEqual(updated.map(item => item.qty), cart.map(item => item.qty));
  assert.equal(cart[0].options[0].modifierOptionId, 100);
});

test("separate pots and separate pending orders do not inherit another taste", () => {
  const cart = [cartItem(1, 0)];
  assert.equal(inheritedPotSpicyChoice(menus[3], cart, menus, modifiers), null);
  assert.equal(inheritedPotSpicyChoice(menus[1], [], menus, modifiers), null);
  assert.equal(posPotKey(menus[4]), null);
});

test("new table stew inherits the current session's taste across separate pot keys", () => {
  assert.equal(inheritedTableSpicyChoice(menus[3], [cartItem(1, 0)], menus, modifiers)?.modifierOptionId, 400);
  assert.equal(inheritedTableSpicyChoice(menus[2], [cartItem(4, 2)], menus, modifiers)?.modifierOptionId, 302);
  assert.equal(inheritedTableSpicyChoice(menus[4], [cartItem(1, 0)], menus, modifiers), null);
  assert.equal(inheritedTableSpicyChoice(menus[3], [], menus, modifiers), null);
});

test("server-side order check accepts shared level zero and rejects mixed levels", () => {
  assert.equal(hasConsistentPotSpiciness([{ potKey: "STEW", optionName: "0.안매움" }, { potKey: "STEW", optionName: "0.순한맛" }]), true);
  assert.equal(hasConsistentPotSpiciness([{ potKey: "STEW", optionName: "0.안매움" }, { potKey: "STEW", optionName: "1.매운맛" }]), false);
  assert.equal(hasConsistentPotSpiciness([{ potKey: "STEW", optionName: "0.안매움" }, { potKey: "SEPARATE", optionName: "2.매운맛" }]), true);
});
