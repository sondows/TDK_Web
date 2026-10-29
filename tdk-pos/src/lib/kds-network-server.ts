import "server-only";

import { headers } from "next/headers";
import { isIP } from "node:net";
import { evaluateKdsNetwork } from "@/lib/kds-network";

export async function getKdsNetworkContext() {
  return evaluateKdsNetwork(await headers(), {
    proxySecret: process.env.KDS_PROXY_SHARED_SECRET,
    lanCidrs: process.env.KDS_INTERNAL_CIDRS,
    vpnCidrs: process.env.KDS_INTERNAL_VPN_CIDRS,
  });
}

/** Sanitized by the Node ingress wrapper; never use this for device exemption. */
export async function getKdsRateLimitIp() {
  const value = (await headers()).get("x-tdk-verified-client-ip");
  return value && isIP(value) !== 0 ? value : null;
}
