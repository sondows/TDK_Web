import styles from "../admin.module.css";

export default function AdminDashboardPage() {
  return (
    <div className={styles.content}>
      <div className={styles.pageHeading}>
        <h1>대시보드</h1>
      </div>
      <section aria-labelledby="admin-welcome-title" className={styles.welcome}>
        <h2 id="admin-welcome-title">TDK 관리센터</h2>
        <p>매장 운영 및 POS 데이터를 관리하는 화면입니다.</p>
      </section>
    </div>
  );
}
