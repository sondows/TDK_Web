import AdminReadOnlyFields from "@/app/admin/AdminReadOnlyFields";
import KdsArrivalSoundForm from "./KdsArrivalSoundForm";
import KdsCookingForm from "./KdsCookingForm";
import KdsCompletionCountdownForm from "./KdsCompletionCountdownForm";
import KdsCompletedTimeShrinkForm from "./KdsCompletedTimeShrinkForm";
import { getKdsArrivalSoundSettings } from "@/lib/kds-arrival-sound-setting";
import { getKdsCookingSettings } from "@/lib/kds-cooking-settings";
import { getKdsCompletionCountdownSeconds } from "@/lib/kds-completion-countdown-setting";
import { getKdsCompletedTimeShrinkStartMinutes } from "@/lib/kds-completed-time-shrink-setting";
import styles from "../../../../admin.module.css";

export default async function AdminKdsSettingsPage() {
  const [settings, cookingSettings, completionCountdownSeconds, completedTimeShrinkStartMinutes] = await Promise.all([
    getKdsArrivalSoundSettings(), getKdsCookingSettings(), getKdsCompletionCountdownSeconds(), getKdsCompletedTimeShrinkStartMinutes(),
  ]);
  return <div className={styles.content}>
    <div className="mx-auto max-w-xl">
      <div className={styles.pageHeading}>
        <h1>KDS 설정</h1>
        <p className={styles.pageDescription}>신규 주문 도착음과 외부 끓임 시간을 설정합니다.</p>
      </div>
      <AdminReadOnlyFields><KdsArrivalSoundForm initial={settings} /></AdminReadOnlyFields>
      <AdminReadOnlyFields><KdsCookingForm initial={cookingSettings} /></AdminReadOnlyFields>
      <AdminReadOnlyFields><KdsCompletionCountdownForm initialSeconds={completionCountdownSeconds} /></AdminReadOnlyFields>
      <AdminReadOnlyFields><KdsCompletedTimeShrinkForm initialMinutes={completedTimeShrinkStartMinutes} /></AdminReadOnlyFields>
    </div>
  </div>;
}
