import QrMenuClient from "@/app/qr/QrMenuClient";
import { emptyQrPublicTitleSettings } from "@/lib/qr-title-model";
import { getQrScreenTitleData } from "@/lib/qr-title-settings";
import { listPublicQrNotices } from "@/lib/qr-notices";
import type { QrPublicNotice } from "@/lib/qr-notice-model";
import QrDevTestBadge from "../QrDevTestBadge";
import { cookies } from "next/headers";
import { getQrAccessTokenFromCookies, getQrOrderAuthAvailability, QR_DEV_TEST_COOKIE, resolveQrDevTestSession, resolveQrOrderSession } from "@/lib/qr-order-auth";
import { DEFAULT_QR_AUTH_GUIDE } from "@/lib/qr-auth-guide-model";
import { getQrAuthGuide } from "@/lib/qr-auth-guide-settings";

export const dynamic = "force-dynamic";

export default async function QrOrderMenuPage() {
  let initialTitleData = emptyQrPublicTitleSettings();
  let notices: QrPublicNotice[] = [];
  try { initialTitleData = await getQrScreenTitleData("order"); } catch { initialTitleData.storeName = "탑동김치찌개"; /* Keep a readable fallback if public title settings are unavailable. */ }
  try { notices = await listPublicQrNotices(); } catch { /* Preserve menu ordering if public notices are unavailable. */ }
  if (!initialTitleData.storeName.trim()) initialTitleData.storeName = "탑동김치찌개";
  const availability = await getQrOrderAuthAvailability();
  const qrAuthFlowEnabled = availability === "READY";
  const qrAuthUnavailable = availability === "UNAVAILABLE";
  const customerPromise = resolveQrDevTestSession((await cookies()).get(QR_DEV_TEST_COOKIE)?.value)
    .then(async customer => customer ?? await resolveQrOrderSession(await getQrAccessTokenFromCookies()));
  const customer = await (qrAuthUnavailable ? customerPromise.catch(() => null) : customerPromise);
  const qrAuthGuide = qrAuthFlowEnabled ? await getQrAuthGuide().catch(() => DEFAULT_QR_AUTH_GUIDE) : DEFAULT_QR_AUTH_GUIDE;
  return <><QrDevTestBadge /><QrMenuClient key={customer?.tableId ?? "no-table"} tableOrderMode
    qrAuthFlowEnabled={qrAuthFlowEnabled} qrAuthUnavailable={qrAuthUnavailable} qrAuthGuide={qrAuthGuide}
    cartTableId={customer?.tableId ?? null} initialTitleData={initialTitleData} notices={notices} /></>;
}
