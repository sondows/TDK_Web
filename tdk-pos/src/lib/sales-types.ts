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
  summary: {
    netSales: number;
    transactionCount: number;
    cancellationCount: number;
  };
  sales: SaleListItem[];
  message?: string;
};

export type SaleDetail = {
  checkoutId: number;
  occurredAt: string;
  tableLabel: string;
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
    qty: number;
    amount: number;
  }>;
  discounts: Array<{
    label: string;
    amount: number;
  }>;
  payments: Array<{
    paymentId: number;
    method: string;
    amount: number;
    status: string;
    approvalNo: string | null;
    paidAt: string;
    cancelledAt: string | null;
    staffName: string | null;
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
