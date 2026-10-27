import { NextResponse, type NextRequest } from "next/server";
import {
  externalAliasTarget,
  externalCanonicalPath,
  isExternalAdminHost,
  isExternalAdminPathAllowed,
  isExternalKdsPath,
  isExternalPosPath,
  isKnownInternalHost,
} from "@/lib/host-access";

function withSearch(pathname: string, request: NextRequest): URL {
  const url = new URL(pathname, request.url);
  url.search = request.nextUrl.search;
  return url;
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const pathname = request.nextUrl.pathname;

  if (!isExternalAdminHost(host)) {
    if (isKnownInternalHost(host)) return NextResponse.next();
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  // Never trust a browser-supplied surface marker; only alias rewrites add this header.
  const externalHeaders = new Headers(request.headers);
  externalHeaders.delete("x-tdk-external-surface");
  const trustedNetwork = request.headers.get("x-tdk-trusted-network") === "caddy-vpn-validated";
  externalHeaders.delete("x-tdk-trusted-network");
  const protectedSurfacePath = isExternalPosPath(pathname);

  if (protectedSurfacePath && !trustedNetwork) {
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.redirect(withSearch("/tdkadm", request), 307);
  }

  const alias = externalAliasTarget(pathname);
  if (alias) {
    const targetAllowed = alias.surface === "pos"
      ? trustedNetwork && (isExternalPosPath(alias.target) || alias.target === "/manifest.webmanifest")
      : alias.surface === "kds"
        ? isExternalKdsPath(alias.target) || alias.target === "/manifest.webmanifest"
        : isExternalAdminPathAllowed(alias.target, request.method);
    if (!targetAllowed) {
      return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const forwardedHeaders = new Headers(externalHeaders);
    forwardedHeaders.set("x-tdk-external-surface", alias.surface);
    const target = withSearch(alias.target, request);
    return NextResponse.rewrite(target, { request: { headers: forwardedHeaders } });
  }

  const canonicalPath = externalCanonicalPath(pathname);
  if (canonicalPath && (request.method === "GET" || request.method === "HEAD")) {
    if (isExternalPosPath(pathname) && !trustedNetwork) {
      return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.redirect(withSearch(canonicalPath, request), 307);
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
