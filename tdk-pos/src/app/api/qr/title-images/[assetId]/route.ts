import { isQrTitleId } from "@/lib/qr-title-model";
import { readQrTitleImage } from "@/lib/qr-title-image-storage";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!isQrTitleId(assetId)) return new Response(null, { status: 404 });
  try {
    const photos = await import("@/lib/qr-title-settings").then(({ listQrTitlePhotos }) => listQrTitlePhotos());
    const photo = photos.find(item => item.assetId === assetId && item.isActive);
    if (!photo) return new Response(null, { status: 404 });
    const bytes = await readQrTitleImage(assetId);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
