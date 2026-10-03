import type { CustomerSummary } from "@/lib/customer";
import styles from "../admin.module.css";

const columns = ["이름", "전화", "이메일", "거래잔액", "거래관리", "수정"];
const emptyValue = "—";

export default function CustomerList({
  customers,
  error,
  loading,
  onEdit,
  onTrade,
  search,
}: {
  customers: CustomerSummary[];
  error: string;
  loading: boolean;
  onEdit: (customer: CustomerSummary) => void;
  onTrade: (customer: CustomerSummary) => void;
  search: string;
}) {
  const emptyMessage = loading
    ? "고객 목록을 불러오는 중입니다."
    : error || (search.trim() ? "검색 결과가 없습니다." : "등록된 고객이 없습니다.");

  return (
    <div className={styles.customerTableScroll}>
      <table className={styles.customerTable}>
        <thead>
          <tr>{columns.map(column => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {loading || error || customers.length === 0 ? (
            <tr>
              <td className={styles.customerEmpty} colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          ) : customers.map(customer => {
            const name = customer.name?.trim() ?? "";
            const contactName = customer.contactName?.trim() ?? "";
            const phone = customer.phone?.trim() ?? "";
            const displayName = name
              ? contactName ? `${name} (${contactName})` : name
              : phone || emptyValue;
            const displayPhone = !name && phone ? emptyValue : phone || emptyValue;
            const balance = customer.tradeBalance;
            const balanceClass = balance > 0
              ? styles.customerPositiveBalance
              : balance < 0 ? styles.customerNegativeBalance : styles.customerZeroBalance;

            return (
              <tr className={!customer.isActive ? styles.customerInactiveRow : undefined} key={customer.customerId}>
                <td className={styles.customerName}>{displayName}</td>
                <td>{displayPhone}</td>
                <td>{customer.email || emptyValue}</td>
                <td className={balanceClass}>{balance > 0 ? "+" : balance < 0 ? "−" : ""}{Math.abs(balance).toLocaleString("ko-KR")}</td>
                <td><button className={styles.customerPaymentBadge} onClick={() => onTrade(customer)} type="button">거래관리</button></td>
                <td>
                  <button className={styles.staffEditButton} onClick={() => onEdit(customer)} type="button">
                    수정
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
