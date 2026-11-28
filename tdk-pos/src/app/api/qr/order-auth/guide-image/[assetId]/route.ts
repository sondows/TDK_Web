import { readQrAuthGuideImage } from "@/lib/qr-auth-guide-settings";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const image = await readQrAuthGuideImage(assetId);
  const headers = { "Cache-Control": "no-store" };
  if (!image) return new Response(null, { status: 404, headers });
  return new Response(new Uint8Array(image), {
    headers: { ...headers, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" },
  });
}
