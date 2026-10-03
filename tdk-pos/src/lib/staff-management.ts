export type StaffRole = "OWNER" | "MANAGER" | "STAFF";

export type StaffSummary = {
  staffId: number;
  name: string;
  role: StaffRole;
  isActive: boolean;
  posEnabled: boolean;
  adminEnabled: boolean;
  adminLoginId: string | null;
  isShared: boolean;
};

export type StaffDraft = {
  name: string;
  role: StaffRole;
  isActive: boolean;
  posEnabled: boolean;
  posPin: string;
  posPinConfirm: string;
  adminEnabled: boolean;
  adminLoginId: string;
  adminPin: string;
  adminPinConfirm: string;
};

export type StaffErrors = Partial<Record<"name" | "role" | "posPin" | "posPinConfirm" | "adminEnabled" | "adminLoginId" | "adminPin" | "adminPinConfirm", string>>;

export function validateStaffDraft(draft: StaffDraft, original?: StaffSummary): StaffErrors {
  const errors: StaffErrors = {};
  if (!draft.name.trim() || draft.name.trim().length > 100) errors.name = "이름을 1~100자로 입력해 주세요.";
  if (!["OWNER", "MANAGER", "STAFF"].includes(draft.role)) errors.role = "권한을 선택해 주세요.";
  if (draft.posEnabled) {
    const required = !original?.posEnabled;
    if ((required || draft.posPin || draft.posPinConfirm) && !/^\d{4}$/.test(draft.posPin)) errors.posPin = "숫자 4자리 PIN을 입력해 주세요.";
    if ((required || draft.posPin || draft.posPinConfirm) && draft.posPin !== draft.posPinConfirm) errors.posPinConfirm = "PIN이 일치하지 않습니다.";
  }
  if (draft.adminEnabled) {
    if (draft.role !== "OWNER") errors.adminEnabled = "현재 관리센터 로그인은 OWNER만 사용할 수 있습니다.";
    const loginId = draft.adminLoginId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId)) errors.adminLoginId = "영문 소문자로 시작하는 3~32자 아이디를 입력해 주세요.";
    const required = !original?.adminEnabled;
    if ((required || draft.adminPin || draft.adminPinConfirm) && !/^\d{6}$/.test(draft.adminPin)) errors.adminPin = "숫자 6자리 PIN을 입력해 주세요.";
    if ((required || draft.adminPin || draft.adminPinConfirm) && draft.adminPin !== draft.adminPinConfirm) errors.adminPinConfirm = "PIN이 일치하지 않습니다.";
  }
  return errors;
}
