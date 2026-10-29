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
    assert.equal(req.headers["x-tdk-verified-client-ip"], undefined);
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
  assert.equal(forged.headers["x-tdk-verified-client-ip"], undefined);
});

test("the production server refuses direct outside traffic and accepts LAN or Caddy ingress", async () => {
  let handler;
  const handled = [];
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
    console: { log: () => {}, error: () => {} },
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
  assert.deepEqual(handled, ["192.168.0.83:3000", "tdkon.myasustor.com"]);
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
