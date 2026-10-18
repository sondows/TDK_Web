export function expectedBusinessCash(openingCash: number, cashReceived: number, cashReturned: number, customerCashMovement: number, otherCashChange: number) {
  return openingCash + cashReceived - cashReturned + customerCashMovement - otherCashChange;
}
