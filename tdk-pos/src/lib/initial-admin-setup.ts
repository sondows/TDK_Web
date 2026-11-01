export type InitialMasterAccountFacts = {
  accountFound: boolean;
  passwordHash: string | null;
  role?: string | null;
  active?: number | null;
  adminEnabled?: number | null;
  terminatedAt?: Date | null;
  staffCode?: string | null;
  isOwner?: boolean;
};

export type InitialMasterAccountState =
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_UNAVAILABLE"
  | "MASTER_PASSWORD_SET"
  | "MASTER_PASSWORD_REQUIRED"
  | "REGISTRATION_NOT_ALLOWED";

export function classifyInitialMasterAccount(account: InitialMasterAccountFacts): InitialMasterAccountState {
  if (!account.accountFound) return "ACCOUNT_NOT_FOUND";
  if (account.active !== 1 || account.adminEnabled !== 1 || account.terminatedAt != null || account.staffCode === "000")
    return "ACCOUNT_UNAVAILABLE";
  if (account.passwordHash !== null) return "MASTER_PASSWORD_SET";
  if (account.isOwner && account.role === "OWNER") return "MASTER_PASSWORD_REQUIRED";
  return "REGISTRATION_NOT_ALLOWED";
}

export function isFirstOwnerSetupAvailable(state: {
  latchExists: boolean;
  setupCompleted: boolean;
  staffExists: boolean;
  ownerExists: boolean;
}) {
  return state.latchExists && !state.setupCompleted && !state.staffExists && !state.ownerExists;
}
