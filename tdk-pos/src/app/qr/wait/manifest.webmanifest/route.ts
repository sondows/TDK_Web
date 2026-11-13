import { buildQrManifest } from "@/lib/qr-manifest";

export function GET() {
  return Response.json(buildQrManifest(true), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
  });
}
