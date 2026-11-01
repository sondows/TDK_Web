/* eslint-disable @typescript-eslint/no-require-imports -- Node runs this CommonJS module before Next.js compiles the app. */
const { timingSafeEqual } = require("node:crypto");
const { isIP } = require("node:net");
const { isWindowsDevOwnerSetupEnabled } = require("./src/lib/owner-setup-mode.cjs");

function ipv4Number(value) {
  if (isIP(value) !== 4) return null;
  const parts = value.split(".").map(Number);
  return (((parts[0] * 0x1000000) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0);
}

function inCidr(ip, cidr) {
  const [networkText, prefixText, extra] = cidr.split("/");
  if (extra !== undefined || !networkText || !/^\d{1,2}$/.test(prefixText ?? "")) return false;
  const address = ipv4Number(ip);
  const network = ipv4Number(networkText);
  const prefix = Number(prefixText);
  if (address === null || network === null || prefix < 1 || prefix > 32) return false;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
}

function isInExplicitKdsNetwork(ip, lanCidrs = "", vpnCidrs = "") {
  return `${lanCidrs},${vpnCidrs}`.split(/[\s,]+/).filter(Boolean).some(cidr => inCidr(ip, cidr));
}

function validSecret(expected, supplied) {
  return typeof expected === "string" && typeof supplied === "string" &&
    /^[0-9a-f]{64}$/i.test(expected) && /^[0-9a-f]{64}$/i.test(supplied) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

function peerIpv4(remoteAddress) {
  const value = typeof remoteAddress === "string" && remoteAddress.startsWith("::ffff:")
    ? remoteAddress.slice(7) : remoteAddress;
  return typeof value === "string" && isIP(value) === 4 ? value : null;
}

/** Mutate Node's incoming headers before Next.js sees any client-supplied attestation. */
function prepareKdsIngressHeaders(request, config) {
  const headers = request.headers;
  const host = typeof headers.host === "string" ? headers.host.toLowerCase() : "";
  const caddyOrigin = host === config.publicHost &&
    validSecret(config.proxySecret, headers["x-tdk-proxy-origin-secret"]);
  const proxyClientIp = headers["x-tdk-proxy-client-ip"];
  const receivedIp = headers["x-tdk-kds-client-ip"];
  const receivedSecret = headers["x-tdk-kds-proxy-secret"];
  const caddyAttested = caddyOrigin && typeof receivedIp === "string" &&
    isIP(receivedIp) === 4 && validSecret(config.proxySecret, receivedSecret);

  delete headers["x-tdk-proxy-origin-secret"];
  delete headers["x-tdk-proxy-client-ip"];
  delete headers["x-tdk-verified-client-ip"];
  delete headers["x-tdk-verified-https"];
  delete headers["x-tdk-local-dev"];
  delete headers["x-tdk-nas-owner-setup"];
  delete headers["x-tdk-kds-client-ip"];
  delete headers["x-tdk-kds-proxy-secret"];
  if (caddyOrigin) {
    headers["x-tdk-verified-https"] = "1";
    if (typeof proxyClientIp === "string" && isIP(proxyClientIp) !== 0) {
      headers["x-tdk-verified-client-ip"] = proxyClientIp;
    }
    if (caddyAttested) {
      headers["x-tdk-kds-client-ip"] = receivedIp;
      headers["x-tdk-kds-proxy-secret"] = config.proxySecret;
    }
    return "caddy";
  }

  // In development, use the kernel-reported peer for rate limits. Forwarded
  // headers are untrusted here; without this, every local request shares the
  // same "unverified-client-ip" bucket.
  if (process.env.NODE_ENV !== "production") {
    const remoteAddress = request.socket?.remoteAddress;
    const rateLimitPeer = peerIpv4(remoteAddress) ??
      (typeof remoteAddress === "string" && isIP(remoteAddress) !== 0 ? remoteAddress : null);
    if (rateLimitPeer) headers["x-tdk-verified-client-ip"] = rateLimitPeer;
  }

  // NAS installation mode and Windows test mode both require local socket attestation.
  // Windows mode is permitted only in development against the isolated test DB.
  const localPeer = peerIpv4(request.socket?.remoteAddress);
  const windowsDevSetup = isWindowsDevOwnerSetupEnabled(process.env);
  const nasSetup = process.env.TDK_NAS_OWNER_SETUP === "1";
  const localHostConnection = (localPeer === "127.0.0.1" || request.socket?.remoteAddress === "::1") &&
    /^(localhost|127\.0\.0\.1):\d+$/.test(host);
  const nasDirectConnection = process.env.NODE_ENV === "production" &&
    localPeer === process.env.TDK_APP_BIND_HOST && host === config.directHost;
  if ((windowsDevSetup && localHostConnection) || (nasSetup && (localHostConnection || nasDirectConnection))) {
    headers["x-tdk-nas-owner-setup"] = "1";
  }

  const loopbackPeer = request.socket?.remoteAddress;
  if (process.env.NODE_ENV !== "production" &&
    (loopbackPeer === "::1" || loopbackPeer === "127.0.0.1" || loopbackPeer === "::ffff:127.0.0.1") &&
    /^(localhost|127\.0\.0\.1):\d+$/.test(host)) {
    headers["x-tdk-local-dev"] = "1";
    return "local-dev";
  }

  const peer = peerIpv4(request.socket?.remoteAddress);
  const excluded = (config.directExcludedIps ?? "").split(/[\s,]+/).filter(Boolean);
  const directLan = host === config.directHost && peer !== null &&
    excluded.length > 0 && excluded.every(ip => isIP(ip) === 4) && !excluded.includes(peer) &&
    isInExplicitKdsNetwork(peer, config.lanCidrs, config.vpnCidrs) &&
    validSecret(config.proxySecret, config.proxySecret);
  if (directLan) {
    headers["x-tdk-verified-client-ip"] = peer;
    headers["x-tdk-kds-client-ip"] = peer;
    headers["x-tdk-kds-proxy-secret"] = config.proxySecret;
    return "direct-lan";
  }
  return "untrusted";
}

module.exports = { isInExplicitKdsNetwork, prepareKdsIngressHeaders };
