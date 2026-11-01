export type SecurityOwnerRecord = { staffId: number; masterPasswordHash: string | null; isActive: unknown; adminEnabled: unknown; terminatedAt?: Date | null };

export function canAddSecurityOwner(target: {
  isActive: unknown; adminEnabled: unknown; loginId: string | null; employeePinHash: string | null;
}) {
  return Number(target.isActive) === 1 && Number(target.adminEnabled) === 1
    && Boolean(target.loginId) && Boolean(target.employeePinHash);
}

export function canRemoveSecurityOwner(owners: SecurityOwnerRecord[], staffId: number) {
  const target = owners.find(owner => owner.staffId === staffId);
  if (!target || owners.length <= 1) return false;
  return owners.some(owner => owner.staffId !== staffId && Boolean(owner.masterPasswordHash)
    && Number(owner.isActive) === 1 && Number(owner.adminEnabled) === 1 && !owner.terminatedAt);
}

export function isSecurityOwnerSetupPending(passwordHash: string | null | undefined) {
  return !passwordHash;
}
