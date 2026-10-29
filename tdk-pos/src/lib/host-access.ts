export const EXTERNAL_ADMIN_HOST = "tdkon.myasustor.com";

const DEFAULT_INTERNAL_HOSTS = ["192.168.0.83", "192.168.0.54", "localhost", "127.0.0.1", "::1"];
const SAFE_READ_METHODS = new Set(["GET", "HEAD"]);
export type ExternalSurface = "pos" | "admin" | "kds";

export function hostnameFromHeader(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try { return new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/^\[|\]$/g, ""); }
  catch { return null; }
}
export function isExternalAdminHost(hostHeader: string | null): boolean {
  return hostnameFromHeader(hostHeader) === EXTERNAL_ADMIN_HOST;
}
export function isKnownInternalHost(hostHeader: string | null, configuredHosts = process.env.POS_INTERNAL_HOSTS): boolean {
  const hostname = hostnameFromHeader(hostHeader);
  if (!hostname) return false;
  return new Set([...DEFAULT_INTERNAL_HOSTS, ...(configuredHosts ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean)]).has(hostname);
}
function isPathOrChild(pathname: string, root: string): boolean { return pathname === root || pathname.startsWith(`${root}/`); }
function isReadOnly(method: string): boolean { return SAFE_READ_METHODS.has(method.toUpperCase()); }
function isPublicAsset(pathname: string, method: string): boolean {
  if (!isReadOnly(method)) return false;
  if (isPathOrChild(pathname, "/_next") || isPathOrChild(pathname, "/icons")) return true;
  if (["/favicon.ico", "/manifest.webmanifest", "/kds.webmanifest"].includes(pathname)) return true;
  return /^\/api\/menu-images\/\d+\/[A-Za-z0-9._-]+$/.test(pathname);
}
function isAdminPageOrApi(pathname: string): boolean {
  return isPathOrChild(pathname, "/admin") || isPathOrChild(pathname, "/api/admin") || isPathOrChild(pathname, "/api/admin-center");
}
export function isExternalPosPath(pathname: string): boolean {
  return pathname === "/login" || isPathOrChild(pathname, "/pos") || isPathOrChild(pathname, "/tdkpos")
    || isPathOrChild(pathname, "/api/auth") || pathname === "/api/staff/active"
    || pathname === "/api/table-cancellations" || pathname === "/api/tables" || pathname === "/api/kds/table-order"
    || isPathOrChild(pathname, "/api/pos") || isPathOrChild(pathname, "/api/table-sessions")
    || isPathOrChild(pathname, "/api/table-session-merges") || isPathOrChild(pathname, "/api/table-layout")
    || (isPathOrChild(pathname, "/api/pos-settings") && !["/api/pos-settings/business-day", "/api/pos-settings/takeout-preparation"].includes(pathname))
    || isPathOrChild(pathname, "/api/order-items") || isPathOrChild(pathname, "/api/checkouts") || isPathOrChild(pathname, "/api/sales")
    || pathname === "/api/admin/verify" || pathname === "/api/admin/verify-pin" || pathname === "/api/admin/grant"
    || pathname === "/api/admin/discount-rules" || isPathOrChild(pathname, "/api/admin/menus") || isPathOrChild(pathname, "/api/admin/staff");
}
export function isExternalKdsPath(pathname: string): boolean {
  return isPathOrChild(pathname, "/kitchen") || isPathOrChild(pathname, "/tdkkds") || isPathOrChild(pathname, "/api/kitchen");
}
/** External host is management-only; shared customer/settings APIs remain for management workflows. */
export function isExternalAdminPathAllowed(pathname: string, method: string): boolean {
  if (pathname === "/") return isReadOnly(method);
  if (isPublicAsset(pathname, method)) return true;
  if (isExternalPosPath(pathname) || isExternalKdsPath(pathname)) return false;
  return isAdminPageOrApi(pathname) || isPathOrChild(pathname, "/api/customers")
    || pathname === "/api/pos-settings/business-day" || pathname === "/api/pos-settings/takeout-preparation";
}
export function isExternalAliasTargetAllowed(surface: ExternalSurface, target: string, method: string, trustedNetwork: boolean): boolean {
  if (surface === "pos") return trustedNetwork && (isExternalPosPath(target) || target === "/manifest.webmanifest");
  if (surface === "kds") return isExternalKdsPath(target) || target === "/manifest.webmanifest";
  return isExternalAdminPathAllowed(target, method);
}
export function externalAliasTarget(pathname: string): { surface: ExternalSurface; target: string } | null {
  const aliases: Array<{ prefix: string; surface: ExternalSurface }> = [
    { prefix: "/tdkpos", surface: "pos" }, { prefix: "/tdkadm", surface: "admin" }, { prefix: "/tdkkds", surface: "kds" },
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
  if (!suffix || suffix === "/kitchen") return { surface: alias.surface, target: "/kitchen" };
  if (suffix === "/kds.webmanifest") return { surface: alias.surface, target: "/manifest.webmanifest" };
  return { surface: alias.surface, target: isPathOrChild(suffix, "/kitchen") ? suffix : `/kitchen${suffix}` };
}
export function internalCanonicalPath(pathname: string): string | null {
  if (pathname === "/kds") return "/tdkkds";
  if (isPathOrChild(pathname, "/tdkadm/admin")) return `/tdkadm${pathname.slice("/tdkadm/admin".length)}`;
  if (isPathOrChild(pathname, "/admin")) return `/tdkadm${pathname.slice("/admin".length)}`;
  if (pathname === "/login") return "/tdkpos/login";
  if (isPathOrChild(pathname, "/pos")) return `/tdkpos${pathname.slice("/pos".length)}`;
  if (isPathOrChild(pathname, "/kitchen")) return `/tdkkds${pathname.slice("/kitchen".length)}`;
  return null;
}
export function externalCanonicalPath(pathname: string): string | null {
  return internalCanonicalPath(pathname);
}
