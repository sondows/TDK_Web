export type SaleDisplayStatus = "COMPLETED" | "PARTIALLY_CANCELLED" | "CANCELLED" | "IN_PROGRESS";

export type SaleListItem = {
  checkoutId: number;
  occurredAt: string;
  orderedAt: string;
  tableLabel: string;
  tableNos: string[];
  menuSummary: string;
  totalAmount: number;
  paymentMethods: string;
  status: SaleDisplayStatus;
};

export type SalesListResponse = {
  success: boolean;
  date: string;
  startDate: string;
  endDate: string;
  sales: SaleListItem[];
  message?: string;
};

export type SaleDetail = {
  checkoutId: number;
  occurredAt: string;
  orderedAt: string;
  customerName?: string | null;
  tableLabel: string;
  tableNos: string[];
  checkoutStatus: string;
  displayStatus: SaleDisplayStatus;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  approvedAmount: number;
  items: Array<{
    orderItemId: number;
    itemName: string;
    unitPrice: number;
    originalUnitPrice?: number;
    qty: number;
    amount: number;
    itemType: "NORMAL" | "COMPONENT" | "SERVICE";
    printOnReceipt: boolean;
  }>;
  discounts: Array<{
    label: string;
    amount: number;
  }>;
  payments: Array<{
    paymentId: number;
    paymentMethodId: number;
    method: string;
    methodCode: string;
    customerDisplayName: string | null;
    customerCouponQuantity: number | null;
    customerCouponUnitAmountSnapshot: number | null;
    customerCouponCashChange: number;
    customerCouponForfeitedAmount: number;
    amount: number;
    appliedAmount: number;
    prepaidCreditAmount: number;
    prepaidReversalAmount: number;
    status: string;
    approvalNo: string | null;
    paidAt: string;
    cancelledAt: string | null;
    staffName: string | null;
    cashReceived: number | null;
    cashChange: number | null;
  }>;
  orderCancellations: Array<{
    cancellationId: number;
    itemName: string;
    qty: number;
    amount: number;
    reason: string;
    cancelledAt: string;
  }>;
};

export type SaleDetailResponse = {
  success: boolean;
  sale?: SaleDetail;
  message?: string;
};
