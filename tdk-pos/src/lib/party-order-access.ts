/** The target may be the current session, or an active peer in the same party. */
export function canEditDisplayedOrderSession(
  currentSessionId: number,
  currentGroupId: number | null,
  visibleSourceSessionId: number,
  visibleSourceGroupId: number | null,
): boolean {
  return visibleSourceSessionId === currentSessionId ||
    (currentGroupId !== null && currentGroupId === visibleSourceGroupId);
}
