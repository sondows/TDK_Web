import AdminReadOnlyFields from "@/app/admin/AdminReadOnlyFields";
import KdsAccountsForm from "../KdsAccountsForm";
import KdsArrivalSoundForm from "./KdsArrivalSoundForm";
import KdsCookingForm from "./KdsCookingForm";
import { getKdsArrivalSoundSettings } from "@/lib/kds-arrival-sound-setting";
import { getKdsCookingSettings } from "@/lib/kds-cooking-settings";
import styles from "../../../../admin.module.css";

export default async function AdminKdsSettingsPage() {
  const [settings, cookingSettings] = await Promise.all([getKdsArrivalSoundSettings(), getKdsCookingSettings()]);
  return <div className={styles.content}>
    <div className="mx-auto max-w-xl">
      <div className={styles.pageHeading}>
        <h1>KDS 설정</h1>
        <p className={styles.pageDescription}>주방 디스플레이의 로그인 계정과 신규 주문 도착음을 설정합니다.</p>
      </div>
      <AdminReadOnlyFields><KdsArrivalSoundForm initial={settings} /></AdminReadOnlyFields>
      <AdminReadOnlyFields><KdsCookingForm initial={cookingSettings} /></AdminReadOnlyFields>
      <KdsAccountsForm />
    </div>
  </div>;
}
