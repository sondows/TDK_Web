export function normalizeDiscountLabel(title: string) {
  const trimmed = title.trim();
  return /할인\s*$/u.test(trimmed) ? trimmed : `${trimmed} 할인`;
}

export function presetSnapshotLabel(title: string, type: "AMOUNT" | "PERCENT", value: number) {
  const label = normalizeDiscountLabel(title);
  return type === "PERCENT" ? `${label} ${value}%` : label;
}
