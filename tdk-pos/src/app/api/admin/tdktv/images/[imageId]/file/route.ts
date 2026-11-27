import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tvImages } from "@/db/schema";
import { requireAdminAccess } from "@/lib/admin-auth";
import { readTvImage } from "@/lib/tdktv-storage";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const imageId = Number((await params).imageId);
  if (!Number.isSafeInteger(imageId) || imageId < 1) return new Response(null, { status: 404 });
  const [image] = await db.select({ screenId: tvImages.screenId, storedName: tvImages.storedName, mimeType: tvImages.mimeType })
    .from(tvImages).where(eq(tvImages.imageId, imageId)).limit(1);
  if (!image) return new Response(null, { status: 404 });
  const bytes = await readTvImage(image.screenId, image.storedName);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": image.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
