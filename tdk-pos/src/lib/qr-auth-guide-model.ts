export const QR_AUTH_GUIDE_TITLE_MAX = 80;
export const QR_AUTH_GUIDE_MESSAGE_MAX = 200;

export const DEFAULT_QR_AUTH_GUIDE = {
  title: "QR 인증하기",
  message: "매장 TV에 표시된 숫자 2자리를 입력해 주세요.",
  imageUrl: null,
} satisfies QrAuthGuide;

export type QrAuthGuide = { title: string; message: string; imageUrl: string | null };

export function normalizeQrAuthGuideText(title: unknown, message: unknown) {
  if (typeof title !== "string" || typeof message !== "string") return null;
  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  if (!trimmedTitle || !trimmedMessage || trimmedTitle.length > QR_AUTH_GUIDE_TITLE_MAX ||
    trimmedMessage.length > QR_AUTH_GUIDE_MESSAGE_MAX) return null;
  return { title: trimmedTitle, message: trimmedMessage };
}

export const qrAuthGuideAssetId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const qrAuthGuideImageUrl = (assetId: string) => `/api/qr/order-auth/guide-image/${assetId}`;
