import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentMethodSettings, paymentOtherDetails, payments } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { getReceiptLogoRaster } from "@/lib/receipt-logo-storage";
import { getStoreInfo } from "@/lib/store-info";
import { buildAccountTransferPrintDocument } from "@/lib/print-document";

export const runtime = "nodejs";

const testAmount = 9_999_999;
const validText = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100 && !/[\r\n]/.test(value);

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    let bankName: string;
    let accountNumber: string;
    let accountHolder: string;
    let totalAmount: number;

    if (body.mode === "TEST") {
      if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 인증이 필요합니다." }, { status: 403 });
      if (!validText(body.bankName) || !validText(body.accountNumber) || !validText(body.accountHolder))
        return Response.json({ success: false, message: "은행명, 계좌번호, 예금주를 입력해 주세요." }, { status: 400 });
      bankName = (body.bankName as string).trim();
      accountNumber = (body.accountNumber as string).trim();
      accountHolder = (body.accountHolder as string).trim();
      totalAmount = testAmount;
    } else if (body.mode === "LIVE" || body.mode === "MANUAL") {
      if (!await getCurrentStaff() && await getPosLoginMode() !== "SHARED")
        return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
      const paymentId = body.paymentId;
      if (!Number.isSafeInteger(paymentId) || Number(paymentId) <= 0)
        return Response.json({ success: false, message: "결제내역을 확인해 주세요." }, { status: 400 });
      const [row] = await db.select({
        totalAmount: payments.appliedAmount,
        accountInfoPrintEnabled: paymentMethodSettings.accountInfoPrintEnabled,
        bankName: paymentMethodSettings.bankName,
        accountNumber: paymentMethodSettings.accountNumber,
        accountHolder: paymentMethodSettings.accountHolder,
      }).from(payments)
        .innerJoin(paymentOtherDetails, eq(paymentOtherDetails.paymentId, payments.paymentId))
        .innerJoin(paymentMethodSettings, eq(paymentMethodSettings.paymentMethodId, payments.paymentMethodId))
        .where(and(
          eq(payments.paymentId, Number(paymentId)),
          eq(payments.status, "APPROVED"),
          eq(paymentMethodSettings.accountInfoEnabled, 1),
        )).limit(1);
      if (!row || (body.mode === "LIVE" && row.accountInfoPrintEnabled !== 1) ||
          !validText(row.bankName) || !validText(row.accountNumber) || !validText(row.accountHolder))
        return Response.json({ success: false, message: "출력 가능한 계좌정보를 찾지 못했습니다." }, { status: 404 });
      bankName = row.bankName!.trim();
      accountNumber = row.accountNumber!.trim();
      accountHolder = row.accountHolder!.trim();
      totalAmount = Math.round(Number(row.totalAmount));
      if (!Number.isSafeInteger(totalAmount) || totalAmount < 0)
        return Response.json({ success: false, message: "결제금액을 확인해 주세요." }, { status: 409 });
    } else {
      return Response.json({ success: false, message: "출력 요청을 확인해 주세요." }, { status: 400 });
    }

    const storeInfo = await getStoreInfo();
    let receiptLogo;
    try {
      receiptLogo = await getReceiptLogoRaster({ throwOnLoadError: true });
    } catch (error) {
      console.error("account transfer notice receipt logo load failed", error);
      return Response.json({ success: false, message: "등록된 영수증 로고를 불러오지 못했습니다. 매장 명판 설정을 확인해 주세요." }, { status: 500 });
    }
    if (!storeInfo.storeName.trim())
      return Response.json({ success: false, message: "매장 명판 설정에 상호명을 등록해 주세요." }, { status: 409 });
    const notice = { storeName: storeInfo.storeName, receiptLogo, totalAmount, bankName, accountNumber, accountHolder };
    return Response.json({
      success: true,
      notice,
      document: buildAccountTransferPrintDocument(notice),
    });
  } catch (error) {
    console.error("account transfer notice preparation failed", error);
    return Response.json({ success: false, message: "계좌이체 안내서를 준비하지 못했습니다." }, { status: 500 });
  }
}
