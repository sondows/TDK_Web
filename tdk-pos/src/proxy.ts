import { NextResponse, type NextRequest } from "next/server";
import { isExternalAdminHost, isExternalAdminPathAllowed, isKnownInternalHost } from "@/lib/host-access";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const pathname = request.nextUrl.pathname;

  if (isExternalAdminHost(host)) {
    if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      return NextResponse.redirect(new URL("/admin/login", request.url), 307);
    }
    if (isExternalAdminPathAllowed(pathname, request.method)) return NextResponse.next();
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  if (isKnownInternalHost(host)) return NextResponse.next();
  return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/:path*"] };
