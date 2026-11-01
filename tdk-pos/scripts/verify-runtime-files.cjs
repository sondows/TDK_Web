/* eslint-disable @typescript-eslint/no-require-imports -- Docker runtime verifier uses Node built-ins. */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");

const root = path.resolve(process.argv[2] ?? "/app");
const requiredPaths = [
  "package.json",
  "server.cjs",
  "kds-ingress.cjs",
  "src/lib/owner-setup-mode.cjs",
  "scripts/recover-owner-program-password.cjs",
  "next.config.ts",
  ".next/BUILD_ID",
  "node_modules/next/package.json",
  "node_modules/mysql2/package.json",
  "node_modules/dotenv/package.json",
  "public",
];
const entrypoints = [
  "server.cjs",
  "kds-ingress.cjs",
  "src/lib/owner-setup-mode.cjs",
  "scripts/recover-owner-program-password.cjs",
];
const missing = [];
const visited = new Set();

function resolveLocal(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [base, `${base}.cjs`, `${base}.js`, `${base}.json`,
    path.join(base, "index.cjs"), path.join(base, "index.js")];
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function inspect(file) {
  const absolute = path.resolve(root, file);
  if (visited.has(absolute)) return;
  visited.add(absolute);
  if (!fs.existsSync(absolute)) {
    missing.push(`${file} (entrypoint)`);
    return;
  }

  const syntax = spawnSync(process.execPath, ["--check", absolute], { encoding: "utf8" });
  if (syntax.status !== 0) {
    missing.push(`${file} (syntax check failed)`);
    return;
  }

  const source = fs.readFileSync(absolute, "utf8");
  const requirePattern = /\brequire\s*\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const match of source.matchAll(requirePattern)) {
    const request = match[2];
    if (request.startsWith(".")) {
      const resolved = resolveLocal(absolute, request);
      if (!resolved) {
        missing.push(`${path.relative(root, absolute)} -> ${request}`);
        continue;
      }
      inspect(path.relative(root, resolved));
    } else if (!Module.isBuiltin(request)) {
      try {
        Module.createRequire(absolute).resolve(request);
      } catch {
        missing.push(`${path.relative(root, absolute)} -> package ${request}`);
      }
    }
  }
}

for (const item of requiredPaths) {
  if (!fs.existsSync(path.join(root, item))) missing.push(`${item} (required runtime path)`);
}
const manifestPath = path.join(root, "package.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const appRequire = Module.createRequire(manifestPath);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    try {
      appRequire.resolve(dependency);
    } catch {
      missing.push(`package.json dependency ${dependency}`);
    }
  }
}
for (const entrypoint of entrypoints) inspect(entrypoint);

if (missing.length > 0) {
  console.error("Runtime image dependency check failed:");
  for (const item of [...new Set(missing)]) console.error(`- ${item}`);
  process.exit(1);
}

// Load the side-effect-free local CommonJS modules as a final resolution check.
require(path.join(root, "kds-ingress.cjs"));
require(path.join(root, "src/lib/owner-setup-mode.cjs"));
Module.createRequire(path.join(root, "server.cjs")).resolve("next");
console.log(`Runtime image dependency check passed (${visited.size} CommonJS files).`);
