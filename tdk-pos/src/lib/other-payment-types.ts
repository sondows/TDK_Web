export type OtherPaymentMethod = {
  id: number;
  name: string;
  isActive: number;
  sortOrder: number;
  configured: boolean;
  inputType: "AMOUNT" | "QUANTITY";
  unitAmount: string | null;
  balancePolicy: "CASH_CHANGE" | "FORFEIT" | null;
  cashChangeEnabled: number | null;
  cashChangeMinPercent: number | null;
  validityEnabled: number | null;
  validFrom: string | null;
  validUntil: string | null;
};
