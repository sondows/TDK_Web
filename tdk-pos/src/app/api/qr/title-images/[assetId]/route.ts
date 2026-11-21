import { isQrTitleId, isQrTitleScreenId } from "@/lib/qr-title-model";
import { readQrTitleImage } from "@/lib/qr-title-image-storage";
import { listQrTitlePhotos, listQrTitleScreenPhotos } from "@/lib/qr-title-settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!isQrTitleId(assetId)) return new Response(null, { status: 404 });
  try {
    const rawScreenId = new URL(request.url).searchParams.get("screen");
    const screenId = rawScreenId === null ? undefined : isQrTitleScreenId(rawScreenId) ? rawScreenId : null;
    if (screenId === null) return new Response(null, { status: 404 });
    const photos = screenId ? await listQrTitleScreenPhotos(screenId) : await listQrTitlePhotos();
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
