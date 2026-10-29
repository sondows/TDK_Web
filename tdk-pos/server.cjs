/* eslint-disable @typescript-eslint/no-require-imports -- The custom Node entrypoint is intentionally CommonJS. */
const http = require("node:http");
const { isIP } = require("node:net");
const next = require("next");
const { isInExplicitKdsNetwork, prepareKdsIngressHeaders } = require("./kds-ingress.cjs");

const port = Number(process.env.PORT ?? "3000");
const bindHost = process.env.TDK_APP_BIND_HOST ?? "0.0.0.0";
const production = process.env.NODE_ENV === "production";
const app = next({ dev: !production, hostname: bindHost, port });
const handle = app.getRequestHandler();
const ingressConfig = {
  publicHost: "tdkon.myasustor.com",
  directHost: process.env.KDS_DIRECT_HOST?.toLowerCase(),
  directExcludedIps: process.env.KDS_DIRECT_EXCLUDED_IPS,
  proxySecret: process.env.KDS_PROXY_SHARED_SECRET,
  lanCidrs: process.env.KDS_INTERNAL_CIDRS,
  vpnCidrs: process.env.KDS_INTERNAL_VPN_CIDRS,
};
const excludedIps = (ingressConfig.directExcludedIps ?? "").split(/[\s,]+/).filter(Boolean);

if (production && (
  !Number.isInteger(port) || port < 1 || port > 65535 ||
  isIP(bindHost) !== 4 || bindHost === "0.0.0.0" ||
  ingressConfig.directHost !== `${bindHost}:${port}` ||
  !/^[0-9a-f]{64}$/i.test(ingressConfig.proxySecret ?? "") ||
  !isInExplicitKdsNetwork(bindHost, ingressConfig.lanCidrs, "") ||
  excludedIps.length === 0 || excludedIps.some(ip => isIP(ip) !== 4)
)) {
  throw new Error("Production ingress configuration is incomplete; check the LAN bind, direct host, CIDR, excluded gateway and proxy secret.");
}

app.prepare().then(() => {
  http.createServer((request, response) => {
    const ingress = prepareKdsIngressHeaders(request, ingressConfig);
    if (production && ingress === "untrusted") {
      response.writeHead(403, { "Cache-Control": "no-store" });
      response.end("Forbidden");
      return;
    }
    void handle(request, response).catch(error => {
      console.error("Request failed", error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  }).listen(port, bindHost, () => {
    console.log(`TDK app listening on ${bindHost}:${port}`);
  });
}).catch(error => {
  console.error("TDK app startup failed", error);
  process.exitCode = 1;
});
