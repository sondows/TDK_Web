import assert from "node:assert/strict";
import test from "node:test";
import { commandHomeAssistantSwitch, HomeAssistantApiError } from "./pos-fan-ha-client.ts";

for (const desiredState of ["on", "off"]) {
  test(`switch.turn_${desiredState} sends the configured entity and confirms its state`, async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ url: String(url), init });
      return calls.length === 1
        ? new Response("[]", { status: 200 })
        : Response.json({ state: desiredState }, { status: 200 });
    };
    const result = await commandHomeAssistantSwitch(
      { baseUrl: "http://ha.test:8123", token: "test-only-token" },
      "switch.sonoff_a4b0026ef4",
      desiredState,
      fetcher,
    );

    assert.deepEqual(result, { success: true, state: desiredState });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `http://ha.test:8123/api/services/switch/turn_${desiredState}`);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { entity_id: "switch.sonoff_a4b0026ef4" });
    assert.equal(calls[1].url, "http://ha.test:8123/api/states/switch.sonoff_a4b0026ef4");
  });
}

test("Home Assistant authentication rejection is surfaced without exposing the token", async () => {
  const fetcher = async () => new Response("unauthorized", { status: 401 });
  await assert.rejects(
    commandHomeAssistantSwitch({ baseUrl: "http://ha.test:8123", token: "test-only-token" }, "switch.sonoff_a4b0026ef4", "on", fetcher),
    error => error instanceof HomeAssistantApiError && error.code === "HA_AUTH_FAILED" && error.httpStatus === 401,
  );
});

test("network failures are classified and do not call any real host", async () => {
  const fetcher = async () => { throw new Error("simulated network error"); };
  await assert.rejects(
    commandHomeAssistantSwitch({ baseUrl: "http://ha.test:8123", token: "test-only-token" }, "switch.sonoff_a4b0026ef4", "on", fetcher),
    error => error instanceof HomeAssistantApiError && error.code === "HA_CONNECTION_FAILED",
  );
});
