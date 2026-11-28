export const EXTERNAL_ADMIN_HOST = "tdkon.myasustor.com";
const QR_DEVELOPMENT_HOST = "tdkimchi.iptime.org";
const QR_DEVELOPMENT_PORT = "8090";

const DEFAULT_INTERNAL_HOSTS = ["192.168.0.83", "192.168.0.54", "localhost", "127.0.0.1", "::1"];
const SAFE_READ_METHODS = new Set(["GET", "HEAD"]);
export type ExternalSurface = "pos" | "admin" | "kds" | "hos";

export function hostnameFromHeader(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try { return new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/^\[|\]$/g, ""); }
  catch { return null; }
}
export function isExternalAdminHost(hostHeader: string | null): boolean {
  return hostnameFromHeader(hostHeader) === EXTERNAL_ADMIN_HOST;
}
/** This marker is trustworthy only after server.cjs has sanitized request headers. */
export function hasVerifiedExternalHttpsIngress(headers: Pick<Headers, "get">): boolean {
  return headers.get("x-tdk-verified-https") === "1";
}
/** Set only by server.cjs after verifying a loopback socket and localhost Host. */
export function hasVerifiedLocalDevelopmentIngress(headers: Pick<Headers, "get">): boolean {
  return headers.get("x-tdk-local-dev") === "1";
}
export function isKnownInternalHost(hostHeader: string | null, configuredHosts = process.env.POS_INTERNAL_HOSTS): boolean {
  const hostname = hostnameFromHeader(hostHeader);
  if (!hostname) return false;
  return new Set([...DEFAULT_INTERNAL_HOSTS, ...(configuredHosts ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean)]).has(hostname);
}
/** The DDNS forwarded port is accepted only by the local development server. */
export function isQrDevelopmentHost(hostHeader: string | null, nodeEnv = process.env.NODE_ENV): boolean {
  if (nodeEnv !== "development" || !hostHeader) return false;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    return parsed.username === "" && parsed.password === "" && parsed.pathname === "/" &&
      parsed.hostname.toLowerCase() === QR_DEVELOPMENT_HOST && parsed.port === QR_DEVELOPMENT_PORT;
  } catch {
    return false;
  }
}
/** Only customer QR pages, QR APIs and the assets required to render them are exposed. */
export function isQrDevelopmentPathAllowed(pathname: string, method: string): boolean {
  const verb = method.toUpperCase();
  if ((pathname === "/qr" || pathname === "/qr/wait" || pathname === "/qrorder" || pathname.startsWith("/qrorder/") || /^\/(?:q|tdkqrs)\/[A-Za-z0-9_-]{1,64}$/.test(pathname) || /^\/(?:q|tdkqrs)\/join\/[A-Za-z0-9_-]{1,64}$/.test(pathname)) && (verb === "GET" || verb === "HEAD")) return true;
  if ((pathname === "/api/qr/menu-catalog" || pathname === "/api/qr/title" || /^\/api\/qr\/title-images\/[0-9a-f-]{36}$/i.test(pathname) || /^\/api\/qr\/wait-orders\/[1-9]\d*$/.test(pathname)) &&
      ["GET", "HEAD"].includes(verb)) return true;
  if ((pathname === "/api/qr/wait-orders" || pathname === "/api/qr/visit" ||
      pathname === "/api/qr/cart-events") && verb === "POST") return true;
  if (/^\/api\/qr\/wait-orders\/[1-9]\d*$/.test(pathname) &&
      ["GET", "PATCH", "DELETE"].includes(verb)) return true;
  if (["GET", "HEAD"].includes(verb) && (
    pathname.startsWith("/_next/") || pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico" || pathname === "/images/menu/no-image.png" ||
    /^\/api\/menu-images\/\d+\/[A-Za-z0-9._-]+$/.test(pathname)
      || /^\/api\/qr\/(?:title-images|notices\/images)\/[0-9a-f-]{36}$/i.test(pathname)
  )) return true;
  if (isCustomerQrApiPathAllowed(pathname, verb)) return true;
  return false;
}
function isPathOrChild(pathname: string, root: string): boolean { return pathname === root || pathname.startsWith(`${root}/`); }
function isReadOnly(method: string): boolean { return SAFE_READ_METHODS.has(method.toUpperCase()); }
function isPublicAsset(pathname: string, method: string): boolean {
  if (!isReadOnly(method)) return false;
  if (isPathOrChild(pathname, "/_next") || isPathOrChild(pathname, "/icons")) return true;
  if (["/favicon.ico", "/manifest.webmanifest", "/kds.webmanifest"].includes(pathname)) return true;
  return /^\/api\/menu-images\/\d+\/[A-Za-z0-9._-]+$/.test(pathname)
    || /^\/api\/qr\/(?:title-images|notices\/images)\/[0-9a-f-]{36}$/i.test(pathname);
}
function isAdminPageOrApi(pathname: string): boolean {
  return isPathOrChild(pathname, "/admin") || isPathOrChild(pathname, "/api/admin") || isPathOrChild(pathname, "/api/admin-center")
    || isPathOrChild(pathname, "/api/tdktv");
}
function isCustomerQrApiPathAllowed(pathname: string, method: string): boolean {
  if (method === "GET" || method === "HEAD") return pathname === "/api/qr/menu-catalog" || pathname === "/api/qr/title"
    || pathname === "/api/qr/notices" || pathname === "/api/qr/table-order-link"
    || pathname === "/api/qr/table-orders" || pathname === "/api/qr/order-auth" || pathname === "/api/qr/visit" || pathname === "/api/qr/fan"
    || /^\/api\/qr\/order-auth\/guide-image\/[0-9a-f-]{36}$/i.test(pathname)
    || /^\/api\/qr\/title-images\/[0-9a-f-]{36}$/i.test(pathname)
    || /^\/api\/qr\/wait-orders\/[1-9]\d*$/.test(pathname)
    || /^\/api\/qr\/table-orders\/[1-9]\d*$/.test(pathname);
  if (method === "POST") return pathname === "/api/qr/table-orders" || pathname === "/api/qr/order-auth" || pathname === "/api/qr/order-auth/verify" || pathname === "/api/qr/order-invites" || pathname === "/api/qr/wait-orders" || pathname === "/api/qr/visit" || pathname === "/api/qr/cart-events" || pathname === "/api/qr/fan";
  if (method === "DELETE" && pathname === "/api/qr/order-auth") return true;
  return method === "PATCH" || method === "DELETE" ? /^\/api\/qr\/wait-orders\/[1-9]\d*$/.test(pathname) : false;
}
function isCustomerQrPageAllowed(pathname: string, method: string): boolean {
  if (!isReadOnly(method)) return false;
  return pathname === "/qr" || pathname === "/qr/wait" || pathname === "/qrorder" || pathname.startsWith("/qrorder/")
    || /^\/(?:q|tdkqrs)\/[A-Za-z0-9_-]{1,64}$/.test(pathname) || /^\/(?:q|tdkqrs)\/join\/[A-Za-z0-9_-]{1,64}$/.test(pathname);
}
export function isExternalPosPath(pathname: string): boolean {
  return pathname === "/login" || isPathOrChild(pathname, "/pos") || isPathOrChild(pathname, "/tdkpos")
    || isPathOrChild(pathname, "/api/auth") || pathname === "/api/staff/active"
    || pathname === "/api/table-cancellations" || pathname === "/api/tables" || pathname === "/api/kds/table-order"
    || pathname === "/api/qr/staff-order-history" || pathname === "/api/qr/staff-order-notifications"
    || pathname === "/api/qr/staff-table-token"
    || isPathOrChild(pathname, "/api/pos") || isPathOrChild(pathname, "/api/table-sessions")
    || isPathOrChild(pathname, "/api/table-session-merges") || isPathOrChild(pathname, "/api/table-layout")
    || (isPathOrChild(pathname, "/api/pos-settings") && !["/api/pos-settings/business-day", "/api/pos-settings/takeout-preparation"].includes(pathname))
    || isPathOrChild(pathname, "/api/order-items") || isPathOrChild(pathname, "/api/checkouts") || isPathOrChild(pathname, "/api/sales")
    || pathname === "/api/account-transfer-notice"
    || pathname === "/api/admin/verify" || pathname === "/api/admin/verify-pin" || pathname === "/api/admin/grant"
    || pathname === "/api/admin/discount-rules" || isPathOrChild(pathname, "/api/admin/menus") || isPathOrChild(pathname, "/api/admin/staff");
}
export function isExternalKdsPath(pathname: string): boolean {
  return isPathOrChild(pathname, "/kitchen") || isPathOrChild(pathname, "/tdkkds") || isPathOrChild(pathname, "/api/kitchen");
}
export function isExternalHosPath(pathname: string): boolean {
  return isPathOrChild(pathname, "/hos") || isPathOrChild(pathname, "/tdkhos") || isPathOrChild(pathname, "/api/hos")
    || pathname === "/api/admin-center/trust/initial-master/status"
    || pathname === "/api/program-trust/master-recovery/register-initial";
}
/** External host is management-only; shared customer/settings APIs remain for management workflows. */
export function isExternalAdminPathAllowed(pathname: string, method: string): boolean {
  if (pathname === "/") return isReadOnly(method);
  if (isPublicAsset(pathname, method)) return true;
  if (/^\/tdktv(?:\/|$)/i.test(pathname)) return isReadOnly(method) &&
    (/^\/tdktv\/(?:dp[1-5]|ad-01|menu-0[1-4])$/i.test(pathname));
  if (/^\/api\/tdktv(?:\/|$)/i.test(pathname)) return isReadOnly(method) &&
    (/^\/api\/tdktv\/(?:DP[1-5]|qr-auth-code)$/i.test(pathname) || /^\/api\/tdktv\/images\/[1-9]\d*$/.test(pathname));
  if (isCustomerQrPageAllowed(pathname, method) || isCustomerQrApiPathAllowed(pathname, method.toUpperCase())) return true;
  if (isExternalPosPath(pathname) || isExternalKdsPath(pathname)) return false;
  // Credential setup endpoints enforce their own one-time proof and origin checks.
  if (method.toUpperCase() === "POST" &&
      ["/api/program-trust/change-temporary-password", "/api/program-trust/pin",
        "/api/program-trust/master-recovery/status",
        "/api/program-trust/master-recovery/register"].includes(pathname)) return true;
  if (pathname === "/api/admin-center/trust/initial-master/status" ||
    pathname === "/api/program-trust/master-recovery/register-initial") return false;
  return isAdminPageOrApi(pathname) || isPathOrChild(pathname, "/api/customers")
    || pathname === "/api/pos-settings/business-day" || pathname === "/api/pos-settings/takeout-preparation";
}
export function isExternalAliasTargetAllowed(surface: ExternalSurface, target: string, method: string, verifiedIngress: boolean): boolean {
  if (surface === "pos") return verifiedIngress && (isExternalPosPath(target) || target === "/manifest.webmanifest");
  if (surface === "kds") return isExternalKdsPath(target) || target === "/manifest.webmanifest";
  if (surface === "hos") return verifiedIngress && isExternalHosPath(target);
  return isExternalAdminPathAllowed(target, method);
}
export function externalAliasTarget(pathname: string): { surface: ExternalSurface; target: string } | null {
  const aliases: Array<{ prefix: string; surface: ExternalSurface }> = [
    { prefix: "/tdkpos", surface: "pos" }, { prefix: "/tdkadm", surface: "admin" }, { prefix: "/tdkkds", surface: "kds" }, { prefix: "/tdkhos", surface: "hos" },
  ];
  const alias = aliases.find(({ prefix }) => isPathOrChild(pathname, prefix));
  if (!alias) return null;
  const suffix = pathname.slice(alias.prefix.length);
  if (alias.surface === "pos") {
    if (!suffix) return { surface: alias.surface, target: "/pos" };
    if (suffix === "/login") return { surface: alias.surface, target: "/login" };
    if (suffix === "/manifest.webmanifest") return { surface: alias.surface, target: "/manifest.webmanifest" };
    return { surface: alias.surface, target: isPathOrChild(suffix, "/pos") ? suffix : `/pos${suffix}` };
  }
  if (alias.surface === "admin") {
    if (!suffix) return { surface: alias.surface, target: "/admin" };
    if (suffix === "/manifest.webmanifest") return { surface: alias.surface, target: "/manifest.webmanifest" };
    return { surface: alias.surface, target: `/admin${suffix}` };
  }
  if (alias.surface === "hos") return { surface: alias.surface, target: suffix ? `/hos${suffix}` : "/hos" };
  if (!suffix || suffix === "/kitchen") return { surface: alias.surface, target: "/kitchen" };
  if (suffix === "/kds.webmanifest") return { surface: alias.surface, target: "/manifest.webmanifest" };
  return { surface: alias.surface, target: isPathOrChild(suffix, "/kitchen") ? suffix : `/kitchen${suffix}` };
}
/** Identify an internal path produced by an alias rewrite. This is only a routing hint;
 * authorization and ingress checks must still run for the rewritten request. */
export function isAliasRewriteTarget(surfaceHeader: string | null, pathname: string): surfaceHeader is ExternalSurface {
  if (surfaceHeader !== "pos" && surfaceHeader !== "admin" && surfaceHeader !== "kds" && surfaceHeader !== "hos") return false;
  if (externalAliasTarget(pathname)) return false;
  if (surfaceHeader === "pos") return isExternalPosPath(pathname);
  if (surfaceHeader === "kds") return isExternalKdsPath(pathname);
  if (surfaceHeader === "hos") return isExternalHosPath(pathname);
  return isAdminPageOrApi(pathname);
}
export function internalCanonicalPath(pathname: string): string | null {
  if (pathname === "/kds") return "/tdkkds";
  if (isPathOrChild(pathname, "/tdkadm/admin")) return `/tdkadm${pathname.slice("/tdkadm/admin".length)}`;
  if (isPathOrChild(pathname, "/admin")) return `/tdkadm${pathname.slice("/admin".length)}`;
  if (pathname === "/login") return "/tdkpos/login";
  if (isPathOrChild(pathname, "/pos")) return `/tdkpos${pathname.slice("/pos".length)}`;
  if (isPathOrChild(pathname, "/kitchen")) return `/tdkkds${pathname.slice("/kitchen".length)}`;
  if (pathname === "/hos") return "/tdkhos";
  if (isPathOrChild(pathname, "/hos")) return `/tdkhos${pathname.slice("/hos".length)}`;
  return null;
}
export function externalCanonicalPath(pathname: string): string | null {
  return internalCanonicalPath(pathname);
}
