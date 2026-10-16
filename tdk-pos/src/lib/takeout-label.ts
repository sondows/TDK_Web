export function takeoutLabel(timeHHmm: string, sequence: number) {
  return `포장${timeHHmm}${sequence > 1 ? `-${sequence}` : ""}`;
}
