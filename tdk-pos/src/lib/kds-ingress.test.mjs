import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ingress from "../../kds-ingress.cjs";
import { evaluateKdsNetwork } from "./kds-network.ts";

const secret = "a".repeat(64);
const config = {
  publicHost: "tdkon.myasustor.com",
  directHost: "192.168.0.83:3000",
  directExcludedIps: "192.168.0.1",
  proxySecret: secret,
  lanCidrs: "192.168.0.0/24",
  vpnCidrs: "",
};

function request(host, remoteAddress, extra = {}) {
  return { headers: { host, ...extra }, socket: { remoteAddress } };
}

function networkOf(req) {
  return evaluateKdsNetwork(new Headers(req.headers), config);
}

test("a direct LAN KDS request uses the socket IP, not browser IP headers", () => {
  const req = request("192.168.0.83:3000", "::ffff:192.168.0.54", {
    "x-forwarded-for": "198.51.100.30",
    "x-tdk-kds-client-ip": "198.51.100.30",
    "x-tdk-kds-proxy-secret": "b".repeat(64),
  });
  assert.equal(ingress.prepareKdsIngressHeaders(req, config), "direct-lan");
  assert.equal(req.headers["x-tdk-kds-client-ip"], "192.168.0.54");
  assert.equal(req.headers["x-tdk-verified-client-ip"], "192.168.0.54");
  assert.equal(networkOf(req).isInternal, true);
});

test("outside peers, gateway NAT and missing settings cannot claim direct LAN access", () => {
  for (const peer of ["198.51.100.30", "192.168.0.1", "172.18.0.1"]) {
    const req = request("192.168.0.83:3000", peer, {
      "x-tdk-kds-client-ip": "192.168.0.54", "x-tdk-kds-proxy-secret": secret,
      "x-tdk-verified-client-ip": "192.168.0.54",
    });
    assert.equal(ingress.prepareKdsIngressHeaders(req, config), "untrusted");
    assert.equal(networkOf(req).isInternal, false);
    assert.equal(req.headers["x-tdk-verified-client-ip"], peer);
  }
  for (const overrides of [{ directHost: undefined }, { directExcludedIps: "" }, { proxySecret: "bad" }, { lanCidrs: "" }]) {
    const req = request("192.168.0.83:3000", "192.168.0.54");
    assert.equal(ingress.prepareKdsIngressHeaders(req, { ...config, ...overrides }), "untrusted");
  }
});

test("only a valid Caddy attestation survives on the public host", () => {
  const approved = request("tdkon.myasustor.com", "172.18.0.2", {
    "x-tdk-proxy-origin-secret": secret,
    "x-tdk-kds-client-ip": "192.168.0.54", "x-tdk-kds-proxy-secret": secret,
  });
  assert.equal(ingress.prepareKdsIngressHeaders(approved, config), "caddy");
  assert.equal(approved.headers["x-tdk-proxy-origin-secret"], undefined);
  assert.equal(networkOf(approved).isInternal, true);

  const external = request("tdkon.myasustor.com", "172.18.0.2", {
    "x-tdk-proxy-origin-secret": secret,
    "x-tdk-proxy-client-ip": "198.51.100.30",
  });
  assert.equal(ingress.prepareKdsIngressHeaders(external, config), "caddy");
  assert.equal(networkOf(external).isInternal, false);
  assert.equal(external.headers["x-tdk-verified-client-ip"], "198.51.100.30");

  const forged = request("tdkon.myasustor.com", "198.51.100.30", {
    "x-tdk-kds-client-ip": "192.168.0.54", "x-tdk-kds-proxy-secret": "b".repeat(64),
    "x-tdk-verified-client-ip": "192.168.0.54",
  });
  assert.equal(ingress.prepareKdsIngressHeaders(forged, config), "untrusted");
  assert.equal(networkOf(forged).isInternal, false);
  assert.equal(forged.headers["x-tdk-verified-client-ip"], "198.51.100.30");
});

test("only the localhost socket can receive a development trust marker", () => {
  const local = request("localhost:3000", "::ffff:127.0.0.1", { "x-tdk-local-dev": "1" });
  assert.equal(ingress.prepareKdsIngressHeaders(local, config), "local-dev");
  assert.equal(local.headers["x-tdk-local-dev"], "1");
  assert.equal(local.headers["x-tdk-verified-client-ip"], "127.0.0.1");
  const forged = request("localhost:3000", "192.168.0.54", { "x-tdk-local-dev": "1" });
  assert.equal(ingress.prepareKdsIngressHeaders(forged, config), "untrusted");
  assert.equal(forged.headers["x-tdk-local-dev"], undefined);
});

test("development rate-limit identity comes from the socket, never a supplied header", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    const direct = request("localhost:3000", "192.168.0.54", {
      "x-tdk-verified-client-ip": "198.51.100.30",
    });
    assert.equal(ingress.prepareKdsIngressHeaders(direct, config), "untrusted");
    assert.equal(direct.headers["x-tdk-verified-client-ip"], "192.168.0.54");
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("NAS owner setup marker requires explicit mode and the real local socket", () => {
  const prior = process.env.TDK_NAS_OWNER_SETUP;
  try {
    process.env.TDK_NAS_OWNER_SETUP = "1";
    const local = request("localhost:3000", "127.0.0.1", { "x-tdk-nas-owner-setup": "forged" });
    ingress.prepareKdsIngressHeaders(local, config);
    assert.equal(local.headers["x-tdk-nas-owner-setup"], "1");
    for (const [host, peer] of [
      ["localhost:3000", "192.168.0.54"],
      ["tdkon.myasustor.com", "127.0.0.1"],
    ]) {
      const forged = request(host, peer, { "x-tdk-nas-owner-setup": "1" });
      ingress.prepareKdsIngressHeaders(forged, config);
      assert.equal(forged.headers["x-tdk-nas-owner-setup"], undefined);
    }
    delete process.env.TDK_NAS_OWNER_SETUP;
    const disabled = request("localhost:3000", "127.0.0.1", { "x-tdk-nas-owner-setup": "1" });
    ingress.prepareKdsIngressHeaders(disabled, config);
    assert.equal(disabled.headers["x-tdk-nas-owner-setup"], undefined);
  } finally {
    if (prior === undefined) delete process.env.TDK_NAS_OWNER_SETUP;
    else process.env.TDK_NAS_OWNER_SETUP = prior;
  }
});

test("production NAS setup accepts only the NAS self-connection on the direct host", () => {
  const prior = { mode: process.env.TDK_NAS_OWNER_SETUP, node: process.env.NODE_ENV,
    bind: process.env.TDK_APP_BIND_HOST };
  try {
    process.env.TDK_NAS_OWNER_SETUP = "1";
    process.env.NODE_ENV = "production";
    process.env.TDK_APP_BIND_HOST = "192.168.0.83";
    const local = request(config.directHost, "192.168.0.83");
    ingress.prepareKdsIngressHeaders(local, config);
    assert.equal(local.headers["x-tdk-nas-owner-setup"], "1");
    const lan = request(config.directHost, "192.168.0.54", { "x-tdk-nas-owner-setup": "1" });
    ingress.prepareKdsIngressHeaders(lan, config);
    assert.equal(lan.headers["x-tdk-nas-owner-setup"], undefined);
    const caddy = request(config.publicHost, "192.168.0.83", {
      "x-tdk-proxy-origin-secret": secret, "x-tdk-nas-owner-setup": "1" });
    ingress.prepareKdsIngressHeaders(caddy, config);
    assert.equal(caddy.headers["x-tdk-nas-owner-setup"], undefined);
  } finally {
    for (const [key, value] of [["TDK_NAS_OWNER_SETUP", prior.mode],
      ["NODE_ENV", prior.node], ["TDK_APP_BIND_HOST", prior.bind]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Windows owner setup attestation is limited to elevated-mode development DB localhost inputs", () => {
  const prior = { windows: process.env.TDK_WINDOWS_DEV_OWNER_SETUP, db: process.env.DB_NAME,
    node: process.env.NODE_ENV, nas: process.env.TDK_NAS_OWNER_SETUP };
  try {
    process.env.NODE_ENV = "development";
    process.env.DB_NAME = "TDK_POS_TEST";
    process.env.TDK_WINDOWS_DEV_OWNER_SETUP = "1";
    delete process.env.TDK_NAS_OWNER_SETUP;
    const local = request("localhost:3000", "127.0.0.1", { "x-tdk-nas-owner-setup": "forged" });
    ingress.prepareKdsIngressHeaders(local, config);
    assert.equal(local.headers["x-tdk-nas-owner-setup"], "1");
    const lan = request("localhost:3000", "192.168.0.54", { "x-tdk-nas-owner-setup": "1" });
    ingress.prepareKdsIngressHeaders(lan, config);
    assert.equal(lan.headers["x-tdk-nas-owner-setup"], undefined);
    process.env.DB_NAME = "TDK_POS";
    const productionDb = request("localhost:3000", "127.0.0.1");
    ingress.prepareKdsIngressHeaders(productionDb, config);
    assert.equal(productionDb.headers["x-tdk-nas-owner-setup"], undefined);
    process.env.DB_NAME = "TDK_POS_TEST";
    process.env.NODE_ENV = "production";
    const production = request("localhost:3000", "127.0.0.1");
    ingress.prepareKdsIngressHeaders(production, config);
    assert.equal(production.headers["x-tdk-nas-owner-setup"], undefined);
  } finally {
    for (const [key, value] of [["TDK_WINDOWS_DEV_OWNER_SETUP", prior.windows], ["DB_NAME", prior.db],
      ["NODE_ENV", prior.node], ["TDK_NAS_OWNER_SETUP", prior.nas]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the production server refuses direct outside traffic and accepts LAN or Caddy ingress", async () => {
  let handler;
  const handled = [];
  const diagnostics = [];
  const fakeHttp = { createServer: callback => ({ listen: (_port, _host, ready) => {
    handler = callback;
    ready();
  } }) };
  const fakeNext = () => ({ prepare: async () => {}, getRequestHandler: () => async req => {
    handled.push(req.headers.host);
  } });
  const code = readFileSync(resolve(import.meta.dirname, "../../server.cjs"), "utf8");
  runInNewContext(code, {
    require: name => name === "node:http" ? fakeHttp : name === "node:net" ? { isIP }
      : name === "next" ? fakeNext : ingress,
    process: { env: { NODE_ENV: "production", PORT: "3000", TDK_APP_BIND_HOST: "192.168.0.83",
      KDS_PROXY_SHARED_SECRET: secret, KDS_INTERNAL_CIDRS: config.lanCidrs,
      KDS_DIRECT_HOST: config.directHost, KDS_DIRECT_EXCLUDED_IPS: config.directExcludedIps } },
    console: { log: () => {}, warn: (label, details) => diagnostics.push({ label, details: JSON.parse(details) }), error: () => {} },
  });
  await Promise.resolve();
  const call = req => {
    const response = { status: 200, writeHead(status) { this.status = status; }, end() {} };
    handler(req, response);
    return response.status;
  };
  assert.equal(call(request("192.168.0.83:3000", "198.51.100.30")), 403);
  assert.equal(call(request("tdkon.myasustor.com", "172.18.0.2")), 403);
  assert.equal(call(request("192.168.0.83:3000", "192.168.0.54")), 200);
  assert.equal(call(request("tdkon.myasustor.com", "172.18.0.2", {
    "x-tdk-proxy-origin-secret": secret,
  })), 200);
  assert.equal(call(request("wrong.example", "172.18.0.2", {
    "x-tdk-proxy-origin-secret": secret,
  })), 403);
  assert.deepEqual(handled, ["192.168.0.83:3000", "tdkon.myasustor.com"]);
  assert.equal(diagnostics.length, 3);
  assert.ok(diagnostics.every(entry => entry.label === "TDK ingress rejected" && entry.details.ingress === "untrusted"));
  assert.deepEqual(diagnostics[1].details, {
    receivedHost: "tdkon.myasustor.com",
    publicHost: config.publicHost,
    hostMatches: true,
    originSecretPresent: false,
    originSecretLength: null,
    expectedSecretLength: 64,
    secretMatches: false,
    ingress: "untrusted",
    remoteAddress: "172.18.0.2",
    nodeEnv: "production",
  });
  assert.equal(diagnostics[2].details.hostMatches, false);
  assert.equal(diagnostics[2].details.originSecretPresent, true);
  assert.equal(diagnostics[2].details.originSecretLength, 64);
  assert.equal(diagnostics[2].details.secretMatches, true);
  assert.equal(JSON.stringify(diagnostics).includes(secret), false);
});

test("production refuses to bind all interfaces when direct-LAN settings are missing", () => {
  const code = readFileSync(resolve(import.meta.dirname, "../../server.cjs"), "utf8");
  assert.throws(() => runInNewContext(code, {
    require: name => name === "node:net" ? { isIP } : name === "next" ? () => ({
      prepare: async () => {}, getRequestHandler: () => async () => {},
    }) : name === "node:http" ? { createServer: () => ({ listen: () => {} }) } : ingress,
    process: { env: { NODE_ENV: "production", PORT: "3000" } },
    console: { log: () => {}, error: () => {} },
  }), /Production ingress configuration is incomplete/);
});
