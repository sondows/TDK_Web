/* eslint-disable @typescript-eslint/no-require-imports -- This utility runs directly as CommonJS under Node. */
/* Read-only route/TLS smoke checks; the deliberately invalid POST exits before DB writes. */
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const address = process.env.DEV_HTTPS_ADDRESS || "192.168.0.54";
const port = Number(process.env.DEV_HTTPS_PORT || 3000);
const certificateDirectory = path.join(process.env.LOCALAPPDATA || "", "TDKON", "DevHttps");
const rootDer = fs.readFileSync(path.join(certificateDirectory, "root-ca.cer"));
const encodedRoot = rootDer.toString("base64").match(/.{1,64}/g).join("\n");
const ca = `-----BEGIN CERTIFICATE-----\n${encodedRoot}\n-----END CERTIFICATE-----\n`;

function request(pathname, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: address,
      port,
      path: pathname,
      method,
      ca,
      rejectUnauthorized: true,
      headers: {
        ...(body ? { "Content-Type": "application/json", Origin: `https://${address}:${port}` } : {}),
      },
    }, response => {
      let content = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { content += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, content }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const page = await request("/tdkhos");
  if (page.status !== 200) throw new Error(`HOS page returned HTTP ${page.status}.`);
  if (!/rel="manifest"[^>]*href="\/tdkhos\/manifest\.webmanifest"|href="\/tdkhos\/manifest\.webmanifest"[^>]*rel="manifest"/.test(page.content)) {
    throw new Error("Rendered HOS page does not link its dedicated manifest.");
  }
  console.log("HTTPS HOS page route: PASS (HTTP 200).");
  console.log("Rendered HOS manifest link: PASS (/tdkhos/manifest.webmanifest).");

  const hosManifestResponse = await request("/tdkhos/manifest.webmanifest");
  if (hosManifestResponse.status !== 200) {
    throw new Error(`HOS manifest route returned HTTP ${hosManifestResponse.status}.`);
  }
  const hosManifest = JSON.parse(hosManifestResponse.content);
  if (hosManifest.id !== "/tdkhos" ||
      hosManifest.name !== "TDKON HOS" || hosManifest.short_name !== "TDKON HOS" || hosManifest.start_url !== "/tdkhos" ||
      hosManifest.scope !== "/tdkhos" || hosManifest.display !== "fullscreen" ||
      hosManifest.orientation !== "portrait" ||
      JSON.stringify(hosManifest.display_override) !== JSON.stringify(["fullscreen", "standalone"]) ||
      JSON.stringify(hosManifest.icons.map(icon => icon.src)) !== JSON.stringify([
        "/icons/tdk-hos-192.png", "/icons/tdk-hos-512.png", "/icons/tdk-hos-maskable-512.png",
      ])) {
    throw new Error("HOS manifest response does not match its isolated fullscreen portrait identity.");
  }
  console.log("Served HOS manifest: PASS (identity, fullscreen-first, portrait, dedicated icons).");
  for (const iconPath of hosManifest.icons.map(icon => icon.src)) {
    const iconResponse = await request(iconPath);
    if (iconResponse.status !== 200) throw new Error(`HOS icon ${iconPath} returned HTTP ${iconResponse.status}.`);
    console.log(`HOS icon: PASS (${iconPath}, HTTP 200).`);
  }

  const otherManifests = [
    ["POS", "/tdkpos/manifest.webmanifest", "/tdkpos"],
    ["ADM", "/tdkadm/manifest.webmanifest", "/tdkadm"],
    ["KDS", "/tdkkds/kds.webmanifest", "/tdkkds"],
  ];
  for (const [label, pathname, expectedId] of otherManifests) {
    const response = await request(pathname);
    if (response.status !== 200) throw new Error(`${label} manifest route returned HTTP ${response.status}.`);
    const manifest = JSON.parse(response.content);
    if (manifest.id !== expectedId || manifest.id === hosManifest.id) {
      throw new Error(`${label} manifest identity was not preserved.`);
    }
  }
  console.log("POS, ADM, and KDS manifest identities: PASS (unchanged and separate from HOS).");

  const trust = await request("/api/hos/auth/trust");
  if (trust.status !== 200) throw new Error(`HOS trust status returned HTTP ${trust.status}.`);
  console.log("HOS trust status route: PASS (HTTP 200).");

  const invalidEnroll = await request("/api/hos/auth/trust", "POST", JSON.stringify({ loginId: "x", password: "" }));
  if (invalidEnroll.status !== 401) {
    throw new Error(`Expected invalid input to stop at HTTP 401 after HTTPS ingress checks; received ${invalidEnroll.status}.`);
  }
  console.log("HTTPS same-origin and local development ingress gate: PASS (invalid input rejected before DB writes).");

  const protectedTables = await request("/api/hos/tables");
  if (protectedTables.status !== 401) {
    throw new Error(`Expected unauthenticated HOS table request to return HTTP 401; received ${protectedTables.status}.`);
  }
  console.log("HOS table API remains session-protected: PASS (HTTP 401 without a session).");
}

main().catch(error => {
  console.error(`Development HTTPS verification failed: ${error.message}`);
  process.exitCode = 1;
});
