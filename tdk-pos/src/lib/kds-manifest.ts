import type { MetadataRoute } from "next";

export function applyKdsDisplayOptions(manifest: MetadataRoute.Manifest) {
  return {
    ...manifest,
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any",
  };
}
