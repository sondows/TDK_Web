import Link from "next/link";
import styles from "../../admin.module.css";

export default function SettingsPage() {
  return (
    <div className={styles.content}>
      <div className={styles.pageHeading}>
        <h1>설정</h1>
        <p className={styles.pageDescription}>매장 운영에 필요한 관리 항목을 설정합니다.</p>
      </div>
      <section aria-label="설정 항목" className={styles.paymentFeatureGrid}>
        <Link className={styles.paymentFeatureCard} href="/admin/settings/other-payments" style={{ textDecoration: "none" }}>
          <h2>기타결제 설정</h2>
          <p>POS에서 사용할 기타 결제수단과 표시 순서를 관리합니다.</p>
        </Link>
      </section>
    </div>
  );
}
