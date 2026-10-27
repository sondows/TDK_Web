export type StaffRole = "OWNER" | "MANAGER" | "STAFF";
export type AdminPermission = "NONE" | "READ_ONLY" | "READ_WRITE";
export const adminPermissionLabel: Record<AdminPermission, string> = { NONE: "접근 불가", READ_ONLY: "조회 전용", READ_WRITE: "읽기·쓰기" };

export type StaffSummary = {
  staffId: number;
  staffCode: string;
  name: string;
  role: StaffRole;
  isActive: boolean;
  posEnabled: boolean;
  kdsEnabled: boolean;
  hasKdsPin: boolean;
  adminEnabled: boolean;
  adminPermission: AdminPermission;
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
  kdsEnabled: boolean;
  kdsPin: string;
  kdsPinConfirm: string;
  adminEnabled: boolean;
  adminPermission: AdminPermission;
  adminLoginId: string;
  adminPin: string;
  adminPinConfirm: string;
};

export type StaffErrors = Partial<Record<"name" | "role" | "posPin" | "posPinConfirm" | "kdsPin" | "kdsPinConfirm" | "adminEnabled" | "adminPermission" | "adminLoginId" | "adminPin" | "adminPinConfirm", string>>;

export function validateStaffDraft(draft: StaffDraft, original?: StaffSummary): StaffErrors {
  const errors: StaffErrors = {};
  if (!draft.name.trim() || draft.name.trim().length > 100) errors.name = "이름을 1~100자로 입력해 주세요.";
  if (!["OWNER", "MANAGER", "STAFF"].includes(draft.role)) errors.role = "권한을 선택해 주세요.";
  if (!["NONE", "READ_ONLY", "READ_WRITE"].includes(draft.adminPermission)) errors.adminPermission = "관리센터 권한을 선택해 주세요.";
  if (draft.adminPermission !== "NONE" && !draft.adminEnabled) errors.adminPermission = "관리센터 로그인을 켜고 아이디와 PIN을 입력해 주세요.";
  if (draft.posEnabled) {
    const required = !original?.posEnabled;
    if ((required || draft.posPin || draft.posPinConfirm) && !/^\d{4}$/.test(draft.posPin)) errors.posPin = "숫자 4자리 PIN을 입력해 주세요.";
    if ((required || draft.posPin || draft.posPinConfirm) && draft.posPin !== draft.posPinConfirm) errors.posPinConfirm = "PIN이 일치하지 않습니다.";
  }
  if (draft.kdsEnabled) {
    const required = !original?.kdsEnabled || !original.hasKdsPin;
    if ((required || draft.kdsPin || draft.kdsPinConfirm) && !/^\d{6}$/.test(draft.kdsPin)) errors.kdsPin = "KDS PIN must contain exactly six digits.";
    if ((required || draft.kdsPin || draft.kdsPinConfirm) && draft.kdsPin !== draft.kdsPinConfirm) errors.kdsPinConfirm = "KDS PIN values do not match.";
  }
  if (draft.adminEnabled) {
    const loginId = draft.adminLoginId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId)) errors.adminLoginId = "영문 소문자로 시작하는 3~32자 아이디를 입력해 주세요.";
    const required = !original?.adminEnabled;
    if ((required || draft.adminPin || draft.adminPinConfirm) && !/^\d{6}$/.test(draft.adminPin)) errors.adminPin = "숫자 6자리 PIN을 입력해 주세요.";
    if ((required || draft.adminPin || draft.adminPinConfirm) && draft.adminPin !== draft.adminPinConfirm) errors.adminPinConfirm = "PIN이 일치하지 않습니다.";
  }
  return errors;
}
