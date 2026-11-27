import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import test from "node:test";
import {
  isExternalAdminPathAllowed, isExternalKdsPath, isExternalHosPath, isExternalPosPath,
  isQrDevelopmentPathAllowed,
} from "./host-access.ts";

const apiRoot = resolve(import.meta.dirname, "../app/api");
const sourceRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(new URL("./api-route-manifest.json", import.meta.url), "utf8"));
const routeMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function listRouteFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listRouteFiles(path) : entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

function listClientSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (path === apiRoot || path.startsWith(`${apiRoot}${sep}`)) return [];
    return entry.isDirectory() ? listClientSourceFiles(path)
      : entry.isFile() && /\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

function discoverRoutes() {
  return listRouteFiles(apiRoot).map(file => {
    const routePath = `/api/${relative(apiRoot, file).split(sep).join("/").replace(/\/route\.ts$/, "")
      .replace(/\[([^\]]+)\]/g, ":$1")}`;
    const source = readFileSync(file, "utf8");
    const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b|export\s+(?:const|let)\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/g)]
      .map(match => match[1] ?? match[2]).sort();
    return { path: routePath, methods: [...new Set(methods)] };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function samplePath(routePath) {
  return routePath.replace(/:assetId/g, "d3519cb2-c301-451e-b3aa-888682bbb641")
    .replace(":screenCode", "DP1").replace(/:[^/]+/g, "1");
}

function routePattern(routePath) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[^/]+/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function expectedSurface(pathname) {
  if (pathname === "/api/db-test" || pathname === "/api/qr/dev-test-session") return "internal";
  if (isExternalPosPath(pathname)) return "POS";
  if (isExternalHosPath(pathname)) return "HOS";
  if (isExternalKdsPath(pathname)) return "KDS";
  if (pathname.startsWith("/api/admin/") || pathname.startsWith("/api/admin-center/")
    || pathname.startsWith("/api/tdktv/")
    || pathname.startsWith("/api/customers") || pathname.startsWith("/api/pos-settings/")
    || pathname.startsWith("/api/program-trust/")) return "ADM";
  if (pathname.startsWith("/api/qr/") || pathname.startsWith("/api/menu-images/")) return "QRS";
  return "shared";
}

test("the API route manifest matches all route handlers and HTTP methods", () => {
  const reviewedManifest = [...manifest].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(discoverRoutes(), reviewedManifest,
    "API routes changed. Review their owning surface, authentication, host policy, and methods, then update api-route-manifest.json.");
});

test("literal frontend API calls point to a known route handler", () => {
  const patterns = manifest.map(route => ({ path: route.path, regex: routePattern(route.path) }));
  const unknown = [];
  for (const file of listClientSourceFiles(sourceRoot)) {
    if (["lib/host-access.ts", "lib/master-recovery-cookie.ts"].includes(relative(sourceRoot, file).split(sep).join("/"))) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(["'`])(\/api\/[^"'`\s]*?)\1/g)) {
      if (match[2].startsWith("/api/printer/")) continue; // Separate Device Agent API, not a Next route.
      const calledPath = match[2].replace(/\$\{query\}$/, "").split(/[?#]/, 1)[0].replace(/\$\{[^}]+\}/g, ":param");
      const isKnown = patterns.some(({ regex, path }) => regex.test(calledPath)
        || (calledPath.endsWith("/") && path.startsWith(calledPath)));
      if (!isKnown) unknown.push(`${relative(sourceRoot, file)}: ${match[2]}`);
    }
  }
  assert.deepEqual(unknown, [], `Frontend API calls have no route handler:\n${unknown.join("\n")}`);
});

test("frontend responses use the shared safe JSON reader instead of direct JSON parsing", () => {
  const uiRoots = [resolve(sourceRoot, "app"), resolve(sourceRoot, "components")];
  const directParsers = uiRoots.flatMap(root => listClientSourceFiles(root))
    .filter(file => !file.startsWith(`${apiRoot}${sep}`))
    .flatMap(file => {
      const source = readFileSync(file, "utf8");
      return /\b[A-Za-z_$][A-Za-z0-9_$]*\.json\(\)/.test(source) ? [relative(sourceRoot, file)] : [];
    });
  assert.deepEqual(directParsers, [], `Use readJsonResponse for UI HTTP responses:\n${directParsers.join("\n")}`);
});

test("every API route method has an intentional host-access policy", () => {
  const issues = [];
  for (const route of manifest) {
    const path = samplePath(route.path);
    const surface = expectedSurface(path);
    if (!route.methods.length || route.methods.some(method => !routeMethods.has(method))) {
      issues.push(`${route.path}: missing or unsupported HTTP method inventory`);
      continue;
    }
    for (const method of route.methods) {
      const adminAllowed = isExternalAdminPathAllowed(path, method);
      const qrDevelopmentAllowed = isQrDevelopmentPathAllowed(path, method);
      if (surface === "internal") {
        if (adminAllowed || qrDevelopmentAllowed || isExternalPosPath(path) || isExternalHosPath(path) || isExternalKdsPath(path)) {
          issues.push(`${route.path} ${method}: internal-only route is reachable through a public surface`);
        }
        continue;
      }
      const allowed = surface === "POS" ? isExternalPosPath(path)
        : surface === "HOS" ? isExternalHosPath(path)
          : surface === "KDS" ? isExternalKdsPath(path)
            : surface === "ADM" ? adminAllowed
              : surface === "QRS" ? adminAllowed || qrDevelopmentAllowed
                : false;
      if (!allowed) issues.push(`${route.path} ${method}: classified ${surface}, but no matching host policy allows it`);
    }
  }
  assert.deepEqual(issues, [], issues.join("\n"));
});

test("staff QR order and token routes require POS ingress and are never customer-open", () => {
  for (const path of ["/api/qr/staff-order-history", "/api/qr/staff-order-notifications", "/api/qr/staff-table-token"]) {
    assert.equal(isExternalPosPath(path), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
    assert.equal(isQrDevelopmentPathAllowed(path, "GET"), false, path);
  }
});

test("staff QR endpoints retain server authentication and customer QR link retains session checks", () => {
  const read = path => readFileSync(resolve(import.meta.dirname, path), "utf8");
  const tokenRoute = read("../app/api/qr/staff-table-token/route.ts");
  const orderHistoryRoute = read("../app/api/qr/staff-order-history/route.ts");
  const notificationsRoute = read("../app/api/qr/staff-order-notifications/route.ts");
  const customerLinkRoute = read("../app/api/qr/table-order-link/route.ts");

  assert.match(tokenRoute, /getCurrentStaff\(\)\s*\?\?\s*await getCurrentHosStaff\(\)/);
  assert.match(tokenRoute, /isHttpsSameOriginRequest\(request\)/);
  assert.match(tokenRoute, /isKnownInternalHost\(request\.headers\.get\("host"\)\)/);
  assert.doesNotMatch(tokenRoute, /requireQrNoticeManager|requireAdminAccess/);
  assert.match(orderHistoryRoute, /getCurrentStaff\(\)\s*\?\?\s*await getCurrentHosStaff\(\)/);
  assert.match(notificationsRoute, /getCurrentStaff\(\)\s*\?\?\s*await getCurrentHosStaff\(\)/);
  assert.match(customerLinkRoute, /isSameOriginQrRequest\(request\)/);
  assert.match(customerLinkRoute, /resolveQrOrderRequest\(request\)/);
});
