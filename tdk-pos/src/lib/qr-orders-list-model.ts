export type QrOrderTableListItem = {
  tableId: number;
  tableNo: string;
  issuedAt: string;
  adultCount: number | null;
  babyCount: number | null;
  hasActiveQrToken: boolean;
  hasPendingQrOrder: boolean;
  hasQrOrderHistory?: boolean;
};

export function sortQrOrderTables(items: QrOrderTableListItem[]) {
  return items.filter(item => item.hasActiveQrToken || item.hasPendingQrOrder).slice().sort((a, b) =>
    a.issuedAt.localeCompare(b.issuedAt, "en") || a.tableId - b.tableId);
}

export function qrOrderPeopleLabel(adultCount: number | null, babyCount: number | null) {
  if (adultCount === null || (adultCount <= 0 && (babyCount ?? 0) <= 0)) return "인원 미입력";
  return `성인 ${adultCount} /${babyCount !== null && babyCount > 0 ? ` 아동 ${babyCount}` : ""}`;
}

export function qrOrderIssuedTimeLabel(issuedAt: string) {
  const time = issuedAt.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(time) ? time : "--:--";
}
