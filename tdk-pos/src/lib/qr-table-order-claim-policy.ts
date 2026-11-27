export type QrRepresentativePermission = "NO_REPRESENTATIVE" | "OWN_PENDING" | "OWN_CONFIRMED" | "OTHER_PENDING" | "OTHER_CONFIRMED";
type Claim = { tableId: number; representativeQrSessionId: number; firstQrOrderId: number; state: "PENDING" | "CONFIRMED" };
type Identity = { tableId: number; representativeQrSessionId: number; firstQrOrderId: number };

export function sameQrClaimIdentity(claim: Claim, identity: Identity): boolean {
  return Number(claim.tableId) === identity.tableId &&
    Number(claim.representativeQrSessionId) === identity.representativeQrSessionId &&
    Number(claim.firstQrOrderId) === identity.firstQrOrderId;
}

export function classifyQrRepresentativePermission(claim: Claim | null, qrSessionId: number): QrRepresentativePermission {
  if (!claim) return "NO_REPRESENTATIVE";
  const own = Number(claim.representativeQrSessionId) === qrSessionId;
  return own ? claim.state === "PENDING" ? "OWN_PENDING" : "OWN_CONFIRMED"
    : claim.state === "PENDING" ? "OTHER_PENDING" : "OTHER_CONFIRMED";
}
