export type SecurityOwnerRecord = { staffId: number; passwordHash: string | null };

export function canAddSecurityOwner(target: {
  isActive: unknown; adminEnabled: unknown; loginId: string | null; employeePinHash: string | null;
}) {
  return Number(target.isActive) === 1 && Number(target.adminEnabled) === 1
    && Boolean(target.loginId) && Boolean(target.employeePinHash);
}

export function canRemoveSecurityOwner(owners: SecurityOwnerRecord[], staffId: number) {
  const target = owners.find(owner => owner.staffId === staffId);
  if (!target || owners.length <= 1) return false;
  return !target.passwordHash || owners.some(owner => owner.staffId !== staffId && Boolean(owner.passwordHash));
}

export function canResetSecurityOwner(
  owners: (SecurityOwnerRecord & { credentialState: "SETUP_PENDING" | "RESET_REQUIRED" | "ACTIVE" })[],
  actorStaffId: number,
  targetStaffId: number,
) {
  const target = owners.find(owner => owner.staffId === targetStaffId);
  if (actorStaffId === targetStaffId || !target || target.credentialState !== "ACTIVE" || !target.passwordHash) return false;
  return owners.some(owner => owner.staffId !== targetStaffId && owner.credentialState === "ACTIVE" && Boolean(owner.passwordHash));
}

export function isSecurityOwnerSetupPending(passwordHash: string | null | undefined) {
  return !passwordHash;
}
