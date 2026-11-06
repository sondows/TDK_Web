export function clampHosRemainingQuantity(currentQuantity: number, requestedRemaining: number) {
  if (!Number.isSafeInteger(currentQuantity) || currentQuantity < 0 || !Number.isSafeInteger(requestedRemaining)) return 0;
  return Math.max(0, Math.min(currentQuantity, requestedRemaining));
}

export function getHosCancellationQuantity(currentQuantity: number, requestedRemaining: number) {
  return currentQuantity - clampHosRemainingQuantity(currentQuantity, requestedRemaining);
}
