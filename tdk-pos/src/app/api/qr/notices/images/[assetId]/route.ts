import { isQrNoticeAssetId } from "@/lib/qr-notice-model";
import { readQrNoticeImage } from "@/lib/qr-notice-image-storage";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ assetId: string }> };

export async function GET(_request: Request, context: Context) {
  const { assetId } = await context.params;
  if (!isQrNoticeAssetId(assetId)) return new Response(null, { status: 404 });
  const image = await readQrNoticeImage(assetId);
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
