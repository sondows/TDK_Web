import assert from "node:assert/strict";
import test from "node:test";
import { buildAppManifest } from "./app-manifest.ts";

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
    assert.deepEqual(manifest.icons.map(({ src }) => src), [`/icons/${icon}-192.png`, `/icons/${icon}-512.png`]);
  }
});
