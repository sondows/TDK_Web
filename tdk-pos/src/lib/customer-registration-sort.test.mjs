import assert from "node:assert/strict";
import { test } from "node:test";
import { compareCustomersByRegistrationNewestFirst } from "./customer.ts";

test("customer picker default comparator sorts newest registrations first", () => {
  const rows = [
    { customerId: 7, createdAt: "2026-11-01T10:00:00.000Z" },
    { customerId: 8, createdAt: "2026-11-05T09:00:00.000Z" },
    { customerId: 9, createdAt: "2026-11-03T08:00:00.000Z" },
  ];
  assert.deepEqual([...rows].sort(compareCustomersByRegistrationNewestFirst).map(row => row.customerId), [8, 9, 7]);
});

test("customer registrations with the same timestamp use descending customer ID", () => {
  const rows = [
    { customerId: 12, createdAt: new Date("2026-11-06T00:00:00.000Z") },
    { customerId: 14, createdAt: new Date("2026-11-06T00:00:00.000Z") },
    { customerId: 13, createdAt: new Date("2026-11-06T00:00:00.000Z") },
  ];
  assert.deepEqual([...rows].sort(compareCustomersByRegistrationNewestFirst).map(row => row.customerId), [14, 13, 12]);
});
