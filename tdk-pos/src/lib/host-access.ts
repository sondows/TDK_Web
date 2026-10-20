export const EXTERNAL_ADMIN_HOST = "tdkon.myasustor.com";

const DEFAULT_INTERNAL_HOSTS = ["192.168.0.83", "192.168.0.54", "localhost", "127.0.0.1", "::1"];

export function hostnameFromHeader(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

export function isExternalAdminHost(hostHeader: string | null): boolean {
  return hostnameFromHeader(hostHeader) === EXTERNAL_ADMIN_HOST;
}

export function isKnownInternalHost(hostHeader: string | null, configuredHosts = process.env.POS_INTERNAL_HOSTS): boolean {
  const hostname = hostnameFromHeader(hostHeader);
  if (!hostname) return false;
  const allowed = new Set([
    ...DEFAULT_INTERNAL_HOSTS,
    ...(configuredHosts ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean),
  ]);
  return allowed.has(hostname);
}

function isPathOrChild(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function isExternalAdminPathAllowed(pathname: string, method: string): boolean {
  if (pathname === "/") return method === "GET" || method === "HEAD";
  if (isPathOrChild(pathname, "/admin")) return true;
  if (isPathOrChild(pathname, "/api/admin")) return true;
  if (isPathOrChild(pathname, "/api/admin-center")) return true;
  if (isPathOrChild(pathname, "/kitchen")) return method === "GET" || method === "HEAD";
  if (isPathOrChild(pathname, "/api/kitchen")) return true;
  if (isPathOrChild(pathname, "/api/pos-settings")) return true;
  if (isPathOrChild(pathname, "/api/customers")) return true;
  if (/^\/api\/menu-images\/\d+\/[A-Za-z0-9._-]+$/.test(pathname)) return method === "GET" || method === "HEAD";
  if (isPathOrChild(pathname, "/_next")) return method === "GET" || method === "HEAD";
  if (pathname === "/manifest.webmanifest" || pathname === "/kds.webmanifest" || pathname === "/favicon.ico") return method === "GET" || method === "HEAD";
  if (isPathOrChild(pathname, "/icons")) return method === "GET" || method === "HEAD";
  return false;
}
