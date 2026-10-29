import { buildAppManifest } from "@/lib/app-manifest";

export function GET() {
  return Response.json(buildAppManifest("admin", true), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
  });
}
