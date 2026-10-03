import styles from "../../admin.module.css";

const managementAreas = [
  { title: "고객결제 관리", description: "고객의 선불금 및 미수금 관련 내역을 관리합니다." },
  { title: "기타결제 관리", description: "쿠폰, 상품권, 식권 등 기타 결제수단을 관리합니다." },
];

export default function PaymentsPage() {
  return (
    <div className={styles.content}>
      <div className={styles.pageHeading}>
        <h1>결제관리</h1>
        <p className={styles.pageDescription}>결제수단 및 고객 결제 관련 항목을 관리합니다.</p>
      </div>
      <section aria-label="결제관리 항목" className={styles.paymentFeatureGrid}>
        {managementAreas.map(area => (
          <article className={styles.paymentFeatureCard} key={area.title}>
            <h2>{area.title}</h2><p>{area.description}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
