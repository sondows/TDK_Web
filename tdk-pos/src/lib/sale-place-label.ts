/** Table numbers get T; takeout session labels are already complete display names. */
export function salePlaceLabel(value: string) {
  if (value === "포장") return value;
  return /^(포장|방문포장|전화포장)\d{4}(?:-\d+)?$/.test(value) ? value : `${value}T`;
}
