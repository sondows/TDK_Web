import { NextResponse, type NextRequest } from "next/server";
import {
  externalAliasTarget,
  externalCanonicalPath,
  isExternalAdminHost,
  isExternalAliasTargetAllowed,
  isExternalAdminPathAllowed,
  isExternalKdsPath,
  isExternalHosPath,
  isExternalPosPath,
  hasVerifiedExternalHttpsIngress,
  isAliasRewriteTarget,
  isKnownInternalHost,
  internalCanonicalPath,
} from "@/lib/host-access";

function withSearch(pathname: string, request: NextRequest): URL {
  const url = new URL(pathname, request.url);
  url.search = request.nextUrl.search;
  return url;
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const pathname = request.nextUrl.pathname;
  const aliasRewriteSurface = isAliasRewriteTarget(request.headers.get("x-tdk-external-surface"), pathname)
    ? request.headers.get("x-tdk-external-surface")
    : null;

  if (!isExternalAdminHost(host)) {
    if (isKnownInternalHost(host)) {
      if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
        return NextResponse.redirect(withSearch("/tdkadm", request), 307);
      }
      const canonicalPath = internalCanonicalPath(pathname);
      if (canonicalPath && !aliasRewriteSurface && (request.method === "GET" || request.method === "HEAD")) {
        return NextResponse.redirect(withSearch(canonicalPath, request), 307);
      }
      const alias = externalAliasTarget(pathname);
      const internalHeaders = new Headers(request.headers);
      internalHeaders.delete("x-tdk-external-surface");
      if (aliasRewriteSurface) internalHeaders.set("x-tdk-external-surface", aliasRewriteSurface);
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

  // Surface markers are routing hints only. They never grant access; ingress and
  // route permissions are checked independently below.
  const externalHeaders = new Headers(request.headers);
  externalHeaders.delete("x-tdk-external-surface");
  if (aliasRewriteSurface) externalHeaders.set("x-tdk-external-surface", aliasRewriteSurface);
  // server.cjs removes any client-supplied value and sets this only after a valid
  // Caddy origin-secret check. POS access is gated by trusted HTTPS ingress;
  // employee identity, program permission and session checks remain in the APIs.
  const verifiedIngress = hasVerifiedExternalHttpsIngress(request.headers);
  externalHeaders.delete("x-tdk-trusted-network");
  const protectedSurfacePath = isExternalPosPath(pathname) || isExternalHosPath(pathname);

  if (protectedSurfacePath && !verifiedIngress) {
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.redirect(withSearch("/tdkadm", request), 307);
  }

  if (pathname === "/tdkkds/kds.webmanifest" || pathname === "/tdkadm/manifest.webmanifest" || (pathname === "/tdkpos/manifest.webmanifest" && verifiedIngress)) {
    return NextResponse.next({ request: { headers: externalHeaders } });
  }

  const canonicalPath = externalCanonicalPath(pathname);
  if (canonicalPath && !aliasRewriteSurface && (request.method === "GET" || request.method === "HEAD")) {
    if (isExternalPosPath(pathname) && !verifiedIngress) {
      return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.redirect(withSearch(canonicalPath, request), 307);
  }

  const alias = externalAliasTarget(pathname);
  if (alias) {
    const targetAllowed = isExternalAliasTargetAllowed(alias.surface, alias.target, request.method, verifiedIngress);
    if (!targetAllowed) {
      return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const forwardedHeaders = new Headers(externalHeaders);
    forwardedHeaders.set("x-tdk-external-surface", alias.surface);
    const target = withSearch(alias.target, request);
    return NextResponse.rewrite(target, { request: { headers: forwardedHeaders } });
  }

  if (protectedSurfacePath && verifiedIngress) {
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
