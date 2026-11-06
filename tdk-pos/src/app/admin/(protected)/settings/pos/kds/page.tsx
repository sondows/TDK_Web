import KdsArrivalSoundForm from "./KdsArrivalSoundForm";
import KdsCookingForm from "./KdsCookingForm";
import KdsCompletionCountdownForm from "./KdsCompletionCountdownForm";
import KdsCompletedTimeShrinkForm from "./KdsCompletedTimeShrinkForm";
import KdsOrderBundleForm from "./KdsOrderBundleForm";
import { getKdsArrivalSoundSettings } from "@/lib/kds-arrival-sound-setting";
import { getKdsCookingSettings } from "@/lib/kds-cooking-settings";
import { getKdsCompletionCountdownSeconds } from "@/lib/kds-completion-countdown-setting";
import { getKdsCompletedTimeShrinkStartMinutes } from "@/lib/kds-completed-time-shrink-setting";
import { getKdsOrderBundleSettings } from "@/lib/kds-order-bundle-setting";
import styles from "../../../../admin.module.css";

export default async function AdminKdsSettingsPage() {
  const [settings, cookingSettings, completionCountdownSeconds, completedTimeShrinkStartMinutes, orderBundleSettings] = await Promise.all([
    getKdsArrivalSoundSettings(), getKdsCookingSettings(), getKdsCompletionCountdownSeconds(), getKdsCompletedTimeShrinkStartMinutes(), getKdsOrderBundleSettings(),
  ]);
  return <div className={styles.content}>
    <div className="max-w-xl">
      <div className={styles.pageHeading}>
        <h1>KDS 설정</h1>
        <p className={styles.pageDescription}>신규 주문 도착음과 외부 끓임 시간을 설정합니다.</p>
      </div>
      <KdsArrivalSoundForm initial={settings} />
      <KdsCookingForm initial={cookingSettings} />
      <KdsCompletionCountdownForm initialSeconds={completionCountdownSeconds} />
      <KdsCompletedTimeShrinkForm initialMinutes={completedTimeShrinkStartMinutes} />
      <KdsOrderBundleForm initial={orderBundleSettings} />
    </div>
  </div>;
}
