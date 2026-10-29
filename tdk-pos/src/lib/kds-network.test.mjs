import assert from "node:assert/strict";
import test from "node:test";
import { canUseKdsSessionOnNetwork, evaluateKdsNetwork, isTrustedPosNetwork } from "./kds-network.ts";

const secret = "a".repeat(64);
const config = { proxySecret: secret, lanCidrs: "192.168.0.0/24", vpnCidrs: "10.77.4.0/24" };

function attested(ip, extra = {}) {
  return new Headers({ "x-tdk-kds-proxy-secret": secret, "x-tdk-kds-client-ip": ip, ...extra });
}

test("new and registered LAN browsers can use a valid employee session without device approval", () => {
  const network = evaluateKdsNetwork(attested("192.168.0.54"), config);
  assert.deepEqual(network, { clientIp: "192.168.0.54", isInternal: true });
  assert.equal(canUseKdsSessionOnNetwork(network.isInternal, null, null), true);
  assert.equal(canUseKdsSessionOnNetwork(network.isInternal, 12, null), true);
});

test("outside the LAN, an approved device and a session bound to it are both required", () => {
  const network = evaluateKdsNetwork(attested("198.51.100.30"), config);
  assert.equal(network.isInternal, false);
  assert.equal(canUseKdsSessionOnNetwork(false, null, null), false);
  assert.equal(canUseKdsSessionOnNetwork(false, 12, null), false);
  assert.equal(canUseKdsSessionOnNetwork(false, 12, 13), false);
  assert.equal(canUseKdsSessionOnNetwork(false, 12, 12), true);
});

test("LAN employee sessions cannot be replayed outside the LAN", () => {
  assert.equal(canUseKdsSessionOnNetwork(true, null, null), true);
  assert.equal(canUseKdsSessionOnNetwork(false, null, null), false);
  assert.equal(canUseKdsSessionOnNetwork(false, null, 12), false);
});

test("browser-supplied IP headers cannot assert LAN access without Caddy's secret", () => {
  const forged = new Headers({
    host: "tdkon.myasustor.com", "x-forwarded-for": "192.168.0.54",
    "x-real-ip": "192.168.0.54", "x-tdk-kds-client-ip": "192.168.0.54",
    "x-tdk-kds-proxy-secret": "b".repeat(64),
  });
  assert.deepEqual(evaluateKdsNetwork(forged, config), { clientIp: null, isInternal: false });
  forged.delete("x-tdk-kds-proxy-secret");
  assert.deepEqual(evaluateKdsNetwork(forged, config), { clientIp: null, isInternal: false });
});

test("POS network marker alone cannot bypass the public-host gate", () => {
  const marker = { "x-tdk-trusted-network": "caddy-vpn-validated" };
  assert.equal(isTrustedPosNetwork(new Headers(marker), config), false);
  assert.equal(isTrustedPosNetwork(attested("192.168.0.54", marker), config), true);
  assert.equal(isTrustedPosNetwork(attested("198.51.100.30", marker), config), false);
  assert.equal(isTrustedPosNetwork(attested("192.168.0.54"), config), false);
});

test("missing configuration, malformed IPs and broad or invalid CIDRs fail closed", () => {
  assert.equal(evaluateKdsNetwork(attested("192.168.0.54"), {}).isInternal, false);
  assert.equal(evaluateKdsNetwork(attested("192.168.0.54"), { proxySecret: secret }).isInternal, false);
  assert.equal(evaluateKdsNetwork(attested("192.168.0.54"), { proxySecret: secret, lanCidrs: "0.0.0.0/0" }).isInternal, false);
  assert.deepEqual(evaluateKdsNetwork(attested("192.168.0.54, 198.51.100.30"), config), { clientIp: null, isInternal: false });
  assert.equal(evaluateKdsNetwork(attested("192.168.1.54"), config).isInternal, false);
});

test("VPN access needs its own explicit CIDR", () => {
  assert.equal(evaluateKdsNetwork(attested("10.77.4.20"), config).isInternal, true);
  assert.equal(evaluateKdsNetwork(attested("10.77.4.20"), { ...config, vpnCidrs: "" }).isInternal, false);
});
