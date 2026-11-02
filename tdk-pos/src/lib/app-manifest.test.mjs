import assert from "node:assert/strict";
import test from "node:test";
import { buildAppManifest } from "./app-manifest.ts";
import { posAppMetadata } from "./pos-app-metadata.ts";

test("POS page metadata explicitly links its own install manifest and icons", () => {
  assert.equal(posAppMetadata.applicationName, "TDKON POS");
  assert.equal(posAppMetadata.manifest, "/tdkpos/manifest.webmanifest");
  assert.deepEqual(posAppMetadata.icons.apple, [
    { url: "/icons/tdk-pos-180.png", sizes: "180x180", type: "image/png" },
  ]);
});

test("each installable surface has an isolated identity, start path, scope, and icon", () => {
  const cases = [
    { surface: "pos", name: "TDKON POS", path: "/tdkpos", icon: "tdk-pos" },
    { surface: "admin", name: "TDKON ADM", path: "/tdkadm", icon: "tdk-adm" },
    { surface: "kds", name: "TDKON KDS", path: "/tdkkds", icon: "tdk-kds" },
  ];

  for (const { surface, name, path, icon } of cases) {
    const manifest = buildAppManifest(surface, surface === "admin");
    assert.equal(manifest.id, path);
    assert.equal(manifest.start_url, path);
    assert.equal(manifest.scope, path);
    assert.equal(manifest.name, name);
    assert.equal(manifest.display, "standalone");
    const iconSources = manifest.icons.map(({ src }) => src);
    assert.deepEqual(iconSources.slice(0, 2), [`/icons/${icon}-192.png`, `/icons/${icon}-512.png`]);
    if (surface === "pos") {
      assert.equal(manifest.short_name, "TDKPOS");
      assert.deepEqual(manifest.icons[2], {
        src: "/icons/tdk-pos-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      });
    } else {
      assert.equal(manifest.short_name, name);
      assert.equal(manifest.icons.length, 2);
    }
  }
});

test("the root internal POS manifest uses the POS scope and maskable icon", () => {
  const manifest = buildAppManifest(null, false);
  assert.equal(manifest.name, "TDKON POS");
  assert.equal(manifest.short_name, "TDKPOS");
  assert.equal(manifest.start_url, "/tdkpos");
  assert.equal(manifest.scope, "/tdkpos");
  assert.ok(manifest.icons.some(icon => icon.purpose === "maskable"));
});

test("the external root manifest remains ADM and does not include the POS icon", () => {
  const manifest = buildAppManifest(null, true);
  assert.equal(manifest.name, "TDKON ADM");
  assert.equal(manifest.start_url, "/tdkadm");
  assert.equal(manifest.scope, "/tdkadm");
  assert.ok(manifest.icons.every(icon => !icon.src.includes("tdk-pos")));
});
