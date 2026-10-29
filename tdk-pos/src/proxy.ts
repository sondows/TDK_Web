import { NextResponse, type NextRequest } from "next/server";
import {
  externalAliasTarget,
  externalCanonicalPath,
  isExternalAdminHost,
  isExternalAliasTargetAllowed,
  isExternalAdminPathAllowed,
  isExternalKdsPath,
  isExternalPosPath,
  isKnownInternalHost,
  internalCanonicalPath,
} from "@/lib/host-access";
import { isTrustedPosNetwork } from "@/lib/kds-network";

function withSearch(pathname: string, request: NextRequest): URL {
  const url = new URL(pathname, request.url);
  url.search = request.nextUrl.search;
  return url;
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const pathname = request.nextUrl.pathname;

  if (!isExternalAdminHost(host)) {
    if (isKnownInternalHost(host)) {
      if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
        return NextResponse.redirect(withSearch("/tdkadm", request), 307);
      }
      const canonicalPath = internalCanonicalPath(pathname);
      if (canonicalPath && (request.method === "GET" || request.method === "HEAD")) {
        return NextResponse.redirect(withSearch(canonicalPath, request), 307);
      }
      const alias = externalAliasTarget(pathname);
      const internalHeaders = new Headers(request.headers);
      internalHeaders.delete("x-tdk-external-surface");
      if (pathname === "/tdkpos/manifest.webmanifest" || pathname === "/tdkkds/kds.webmanifest" || pathname === "/tdkadm/manifest.webmanifest") {
        return NextResponse.next({ request: { headers: internalHeaders } });
      }
      if (alias) {
        internalHeaders.set("x-tdk-external-surface", alias.surface);
        return NextResponse.rewrite(withSearch(alias.target, request), { request: { headers: internalHeaders } });
      }
      return NextResponse.next({ request: { headers: internalHeaders } });
    }
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  // Never trust a browser-supplied surface marker; only alias rewrites add this header.
  const externalHeaders = new Headers(request.headers);
  externalHeaders.delete("x-tdk-external-surface");
  const trustedNetwork = isTrustedPosNetwork(request.headers, {
    proxySecret: process.env.KDS_PROXY_SHARED_SECRET,
    lanCidrs: process.env.KDS_INTERNAL_CIDRS,
    vpnCidrs: process.env.KDS_INTERNAL_VPN_CIDRS,
  });
  externalHeaders.delete("x-tdk-trusted-network");
  const protectedSurfacePath = isExternalPosPath(pathname);

  if (protectedSurfacePath && !trustedNetwork) {
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.redirect(withSearch("/tdkadm", request), 307);
  }

  if (pathname === "/tdkkds/kds.webmanifest" || pathname === "/tdkadm/manifest.webmanifest" || (pathname === "/tdkpos/manifest.webmanifest" && trustedNetwork)) {
    return NextResponse.next({ request: { headers: externalHeaders } });
  }

  const canonicalPath = externalCanonicalPath(pathname);
  if (canonicalPath && (request.method === "GET" || request.method === "HEAD")) {
    if (isExternalPosPath(pathname) && !trustedNetwork) {
      return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.redirect(withSearch(canonicalPath, request), 307);
  }

  const alias = externalAliasTarget(pathname);
  if (alias) {
    const targetAllowed = isExternalAliasTargetAllowed(alias.surface, alias.target, request.method, trustedNetwork);
    if (!targetAllowed) {
      return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const forwardedHeaders = new Headers(externalHeaders);
    forwardedHeaders.set("x-tdk-external-surface", alias.surface);
    const target = withSearch(alias.target, request);
    return NextResponse.rewrite(target, { request: { headers: forwardedHeaders } });
  }

  if (protectedSurfacePath && trustedNetwork) {
    return NextResponse.next({ request: { headers: externalHeaders } });
  }
  if (isExternalKdsPath(pathname)) {
    return NextResponse.next({ request: { headers: externalHeaders } });
  }
  if (isExternalAdminPathAllowed(pathname, request.method)) {
    return NextResponse.next({ request: { headers: externalHeaders } });
  }
  return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/:path*"] };
