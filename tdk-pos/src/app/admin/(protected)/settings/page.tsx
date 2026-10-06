import Link from "next/link";
import styles from "../../admin.module.css";

const features = [
  { href: "/admin/settings/store", title: "매장 설정", description: "매장 정보, POS 로그인 방식, 자동 초기화 설정을 관리합니다." },
  { href: "/admin/settings/discounts", title: "할인 설정", description: "POS에서 사용할 할인 사전 설정을 관리합니다." },
  { href: "/admin/settings/other-payments", title: "기타결제 설정", description: "POS의 기타 결제수단과 표시 순서를 관리합니다." },
];

export default function SettingsPage() {
  return <div className={styles.content}>
    <div className={styles.pageHeading}><h1>설정</h1><p className={styles.pageDescription}>매장 운영에 필요한 기준정보와 POS 설정을 관리합니다.</p></div>
    <section aria-label="설정 항목" className={styles.paymentFeatureGrid}>
      {features.map(item => <Link className={styles.paymentFeatureCard} href={item.href} key={item.href} style={{ textDecoration: "none" }}><h2>{item.title}</h2><p>{item.description}</p></Link>)}
    </section>
  </div>;
}
