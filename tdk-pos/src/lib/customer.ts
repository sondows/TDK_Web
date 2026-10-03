export type CustomerSummary = {
  customerId: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  isPaymentManaged: boolean;
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
};

export type CustomerFieldErrors = Partial<Record<"name" | "contactName" | "phone" | "email" | "memo" | "isPaymentManaged", string>>;

export type CustomerCreateValues = {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  isPaymentManaged: number;
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
  if (Object.keys(errors).length) return { values: null, errors };
  return {
    values: {
      name,
      contactName: contactName || null,
      phone: phone || null,
      email: email || null,
      memo: memo || null,
      isPaymentManaged: body.isPaymentManaged === true ? 1 : 0,
    },
    errors,
  };
}
