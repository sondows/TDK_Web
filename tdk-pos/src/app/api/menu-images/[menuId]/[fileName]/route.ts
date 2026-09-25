import { readFile } from "fs/promises";
import { menuImageFilePath } from "@/lib/menu-image-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ menuId: string; fileName: string }> }) {
  try {
    const { menuId: menuIdParam, fileName } = await params;
    const menuId = Number(menuIdParam);
    const image = await readFile(menuImageFilePath(menuId, fileName));
    return new Response(image, { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
