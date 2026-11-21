export function qrOrderApprovalTarget(action: "ACCEPT" | "REJECT", responseSucceeded: boolean, tableId: number | null | undefined) {
  return action === "ACCEPT" && responseSucceeded && Number.isSafeInteger(tableId) && Number(tableId) > 0
    ? Number(tableId)
    : null;
}
