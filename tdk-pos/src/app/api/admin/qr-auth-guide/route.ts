import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { normalizeQrAuthGuideText } from "@/lib/qr-auth-guide-model";
import { getQrAuthGuide, saveQrAuthGuide } from "@/lib/qr-auth-guide-settings";
import { QR_NOTICE_IMAGE_MAX_BYTES } from "@/lib/qr-notice-image-storage";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const failure = (message: string, status: number) => Response.json({ success: false, message }, { status, headers });
async function canManageGuide() {
  const staff = await getCurrentAdminStaff();
  return Boolean(staff && canManageMenu(staff.role));
}

export async function GET() {
  if (!await canManageGuide()) return failure("QR 설정 관리 권한이 필요합니다.", 403);
  try {
    return Response.json({ success: true, guide: await getQrAuthGuide() }, { headers });
  } catch {
    return failure("인증 안내를 불러오지 못했습니다.", 503);
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginQrRequest(request) || !await canManageGuide()) return failure("QR 설정 관리 권한이 필요합니다.", 403);
  if (Number(request.headers.get("content-length")) > QR_NOTICE_IMAGE_MAX_BYTES + 1024 * 1024)
    return failure("이미지는 10MB 이하로 등록해 주세요.", 413);
  const form = await request.formData().catch(() => null);
  if (!form) return failure("설정 내용을 확인해 주세요.", 400);
  const text = normalizeQrAuthGuideText(form.get("title"), form.get("message"));
  if (!text) return failure("제목은 80자, 안내 문구는 200자 이내로 입력해 주세요.", 400);
  const photo = form.get("photo");
  const action = form.get("photoAction");
  if (action !== "keep" && action !== "remove" && action !== "replace")
    return failure("사진 변경 옵션을 확인해 주세요.", 400);
  let image: Buffer | "keep" | "remove";
  if (action === "replace") {
    if (!(photo instanceof File) || photo.size === 0) return failure("이미지 파일을 선택해 주세요.", 400);
    if (photo.size > QR_NOTICE_IMAGE_MAX_BYTES) return failure("이미지는 10MB 이하로 등록해 주세요.", 413);
    image = Buffer.from(await photo.arrayBuffer());
  } else image = action;
  try {
    return Response.json({ success: true, guide: await saveQrAuthGuide(text, image) }, { headers });
  } catch (error) {
    if (error instanceof Error && error.name === "QrAuthGuideImageError")
      return failure("올바른 JPG, PNG, WebP 이미지인지 확인해 주세요.", 400);
    console.error("QR authentication guide save failed", error);
    return failure("인증 안내를 저장하지 못했습니다.", 503);
  }
}
