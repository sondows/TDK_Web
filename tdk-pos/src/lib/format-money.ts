/** POS monetary display: comma-grouped numbers without a currency suffix. */
export function formatMoney(value: number | string) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(
    Number(value),
  );
}
