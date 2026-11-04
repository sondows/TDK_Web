import { getCurrentStaff } from "@/lib/auth";
import { getReceiptLogoRaster } from "@/lib/receipt-logo-storage";
import { getStoreInfo } from "@/lib/store-info";

export const runtime = "nodejs";

export async function GET() {
  if (!await getCurrentStaff()) {
    return Response.json({ success: false, message: "로그인이 필요합니다." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const [storeInfo, receiptLogo] = await Promise.all([getStoreInfo(), getReceiptLogoRaster({ throwOnLoadError: true })]);
    return Response.json({ success: true, storeInfo, receiptLogo }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("customer ledger print header query failed", error);
    return Response.json({ success: false, message: "영수증 인쇄 정보를 불러오지 못했습니다." }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
