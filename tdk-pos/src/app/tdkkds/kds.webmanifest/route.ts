import { applyKdsDisplayOptions } from "@/lib/kds-manifest";
import { buildAppManifest } from "@/lib/app-manifest";

export function GET() {
  return Response.json(applyKdsDisplayOptions(buildAppManifest("kds", false)), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
  });
}
