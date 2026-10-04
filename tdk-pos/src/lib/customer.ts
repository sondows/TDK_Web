export type CustomerSummary = {
  customerId: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  isPaymentManaged: boolean;
  usesFixedCoupon: boolean;
  fixedCouponAmount: number | null;
  fixedCouponBalancePolicy: "CASH_CHANGE" | "FORFEIT";
  fixedCouponCashChangeEnabled: boolean;
  fixedCouponCashChangeMinPercent: number | null;
  isActive: boolean;
  tradeBalance: number;
};

export type CustomerCreateDraft = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  memo: string;
  isPaymentManaged: boolean;
  usesFixedCoupon: boolean;
  fixedCouponAmount: string;
  fixedCouponBalancePolicy: "CASH_CHANGE" | "FORFEIT";
  fixedCouponCashChangeEnabled: boolean;
  fixedCouponCashChangeMinPercent: string;
};

export type CustomerFieldErrors = Partial<Record<"name" | "contactName" | "phone" | "email" | "memo" | "isPaymentManaged" | "usesFixedCoupon" | "fixedCouponAmount" | "fixedCouponBalancePolicy" | "fixedCouponCashChangeEnabled" | "fixedCouponCashChangeMinPercent", string>>;

export type CustomerCreateValues = {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  isPaymentManaged: number;
  usesFixedCoupon: number;
  fixedCouponAmount: string | null;
  fixedCouponBalancePolicy: "CASH_CHANGE" | "FORFEIT";
  fixedCouponCashChangeEnabled: number;
  fixedCouponCashChangeMinPercent: number | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared UI/server validation; the API always validates the request again. */
export function validateCustomerCreate(input: unknown): { values: CustomerCreateValues | null; errors: CustomerFieldErrors } {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const errors: CustomerFieldErrors = {};
  const read = (key: keyof CustomerCreateDraft, maxLength: number, label: string) => {
    const raw = body[key];
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      errors[key] = `${label}을(를) 확인해 주세요.`;
      return "";
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length > maxLength) errors[key] = `${label}은(는) ${maxLength}자 이내로 입력해 주세요.`;
    return value;
  };
  const name = read("name", 100, "이름");
  const contactName = read("contactName", 100, "담당");
  const phone = read("phone", 30, "전화");
  const email = read("email", 255, "이메일");
  const memo = read("memo", 2000, "메모");
  if (!name) errors.name = "이름을 입력해 주세요.";
  if (email && !emailPattern.test(email)) errors.email = "올바른 이메일 형식으로 입력해 주세요.";
  if (body.isPaymentManaged !== undefined && typeof body.isPaymentManaged !== "boolean") {
    errors.isPaymentManaged = "결제관리 여부를 확인해 주세요.";
  }
  if (body.usesFixedCoupon !== undefined && typeof body.usesFixedCoupon !== "boolean") {
    errors.usesFixedCoupon = "정액쿠폰 사용 여부를 확인해 주세요.";
  }
  const usesFixedCoupon = body.usesFixedCoupon === true;
  const rawPolicy = body.fixedCouponBalancePolicy;
  const fixedCouponBalancePolicy = rawPolicy === "CASH_CHANGE" ? "CASH_CHANGE" : "FORFEIT";
  if (usesFixedCoupon && rawPolicy !== "CASH_CHANGE" && rawPolicy !== "FORFEIT") {
    errors.fixedCouponBalancePolicy = "쿠폰 초과금액 처리 방식을 선택해 주세요.";
  }
  const rawCashChangeEnabled = body.fixedCouponCashChangeEnabled;
  if (usesFixedCoupon && typeof rawCashChangeEnabled !== "boolean") {
    errors.fixedCouponCashChangeEnabled = "현금 거스름 사용 여부를 확인해 주세요.";
  }
  const fixedCouponCashChangeEnabled = rawCashChangeEnabled === true;
  const rawCashChangePercent = body.fixedCouponCashChangeMinPercent;
  let fixedCouponCashChangeMinPercent: number | null = null;
  if (usesFixedCoupon && fixedCouponCashChangeEnabled) {
    const percent = typeof rawCashChangePercent === "string" || typeof rawCashChangePercent === "number" ? Number(rawCashChangePercent) : NaN;
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      errors.fixedCouponCashChangeMinPercent = "현금 거스름 기준을 0~100 사이의 정수로 입력해 주세요.";
    } else {
      fixedCouponCashChangeMinPercent = percent;
    }
  }
  const rawCouponAmount = body.fixedCouponAmount;
  let fixedCouponAmount: string | null = null;
  if (usesFixedCoupon) {
    const couponAmount = typeof rawCouponAmount === "string" || typeof rawCouponAmount === "number" ? Number(rawCouponAmount) : NaN;
    if (!Number.isSafeInteger(couponAmount) || couponAmount <= 0 || couponAmount > 999999999999) {
      errors.fixedCouponAmount = "쿠폰 1장 금액을 1원 이상의 정수로 입력해 주세요.";
    } else {
      fixedCouponAmount = couponAmount.toFixed(2);
    }
  }
  if (Object.keys(errors).length) return { values: null, errors };
  return {
    values: {
      name,
      contactName: contactName || null,
      phone: phone || null,
      email: email || null,
      memo: memo || null,
      isPaymentManaged: body.isPaymentManaged === true ? 1 : 0,
      usesFixedCoupon: usesFixedCoupon ? 1 : 0,
      fixedCouponAmount,
      fixedCouponBalancePolicy,
      fixedCouponCashChangeEnabled: fixedCouponCashChangeEnabled ? 1 : 0,
      fixedCouponCashChangeMinPercent,
    },
    errors,
  };
}
