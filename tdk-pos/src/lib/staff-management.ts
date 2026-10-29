export type StaffRole = "OWNER" | "MANAGER" | "STAFF";

export type StaffSummary = {
  staffId: number; loginId: string | null; name: string; role: StaffRole; isActive: boolean;
  posEnabled: boolean; kdsEnabled: boolean; hosEnabled: boolean; hasEmployeePin: boolean; hasLegacyPosPin: boolean; hasKdsPin: boolean;
  hasKdsPassword: boolean; hasKdsTotp: boolean; kdsPinChangeRequired: boolean;
  adminEnabled: boolean; hasLegacyAdminPin: boolean; isShared: boolean;
  isDesignatedOwner?: boolean;
};

export type StaffDraft = {
  name: string; loginId: string; role: StaffRole; isActive: boolean; posEnabled: boolean; kdsEnabled: boolean; hosEnabled: boolean;
  employeePin: string; employeePinConfirm: string;
  adminEnabled: boolean;
};

export type StaffErrors = Partial<Record<"name" | "loginId" | "role" | "employeePin" | "employeePinConfirm" | "adminEnabled", string>>;

export function validateStaffDraft(draft: StaffDraft, original?: StaffSummary): StaffErrors {
  const errors: StaffErrors = {};
  if (!draft.name.trim() || draft.name.trim().length > 100) errors.name = "이름을 1~100자로 입력해 주세요.";
  const loginId = draft.loginId.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId)) errors.loginId = "ID는 영문 소문자로 시작하는 3~32자의 영문 소문자, 숫자, . _ - 조합으로 입력해 주세요.";
  if (original && original.loginId && loginId !== original.loginId.toLowerCase() && loginId.length < 3) errors.loginId = "유효한 ID를 입력해 주세요.";
  if (!["OWNER", "MANAGER", "STAFF"].includes(draft.role)) errors.role = "권한을 선택해 주세요.";
  const employeePinRequired = (draft.posEnabled || draft.kdsEnabled || draft.hosEnabled || draft.adminEnabled) && !original?.hasEmployeePin;
  if (draft.employeePin || draft.employeePinConfirm || employeePinRequired) {
    if (!/^\d{6}$/.test(draft.employeePin)) errors.employeePin = "직원 공통 PIN은 숫자 6자리여야 합니다.";
    if (draft.employeePin !== draft.employeePinConfirm) errors.employeePinConfirm = "PIN이 일치하지 않습니다.";
  }
  return errors;
}
