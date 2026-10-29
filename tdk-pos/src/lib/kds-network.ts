import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { isInExplicitKdsNetwork } from "../../kds-ingress.cjs";

export const KDS_CLIENT_IP_HEADER = "x-tdk-kds-client-ip";
export const KDS_PROXY_SECRET_HEADER = "x-tdk-kds-proxy-secret";

export type KdsNetworkContext = { clientIp: string | null; isInternal: boolean };

export { isInExplicitKdsNetwork };

/** Only Caddy may attest the client IP. Missing or invalid attestation fails closed. */
export function evaluateKdsNetwork(
  requestHeaders: Headers,
  config: { proxySecret?: string; lanCidrs?: string; vpnCidrs?: string },
): KdsNetworkContext {
  const expectedSecret = config.proxySecret ?? "";
  const suppliedSecret = requestHeaders.get(KDS_PROXY_SECRET_HEADER) ?? "";
  if (!/^[0-9a-f]{64}$/i.test(expectedSecret) || !/^[0-9a-f]{64}$/i.test(suppliedSecret) ||
      !timingSafeEqual(Buffer.from(expectedSecret, "hex"), Buffer.from(suppliedSecret, "hex"))) {
    return { clientIp: null, isInternal: false };
  }
  const clientIp = requestHeaders.get(KDS_CLIENT_IP_HEADER)?.trim() ?? "";
  if (isIP(clientIp) !== 4) return { clientIp: null, isInternal: false };
  return {
    clientIp,
    isInternal: isInExplicitKdsNetwork(clientIp, config.lanCidrs ?? "", config.vpnCidrs ?? ""),
  };
}

/** The POS network marker is only meaningful when Caddy also attests a LAN IP. */
export function isTrustedPosNetwork(
  requestHeaders: Headers,
  config: { proxySecret?: string; lanCidrs?: string; vpnCidrs?: string },
): boolean {
  return requestHeaders.get("x-tdk-trusted-network") === "caddy-vpn-validated" &&
    evaluateKdsNetwork(requestHeaders, config).isInternal;
}

/** A LAN login has no device binding; it cannot be replayed from outside the LAN. */
export function canUseKdsSessionOnNetwork(
  isInternal: boolean, boundDeviceId: number | null, approvedDeviceId: number | null,
): boolean {
  return isInternal || (boundDeviceId !== null && approvedDeviceId === boundDeviceId);
}
