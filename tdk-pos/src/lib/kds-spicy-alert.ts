export type KdsSpicyAlert = { id: number; sessionId: number; message: string; createdAtMs: number };

export function latestKdsSpicyAlert(alerts: KdsSpicyAlert[], sessionId: number, nowMs: number) {
  let latest: KdsSpicyAlert | null = null;
  for (const alert of alerts) {
    const ageMs = nowMs - Number(alert.createdAtMs);
    if (Number(alert.sessionId) !== sessionId || ageMs < 0 || ageMs >= 10000) continue;
    if (!latest || Number(alert.id) > Number(latest.id)) latest = alert;
  }
  if (!latest) return null;
  const lastArrow = latest.message.lastIndexOf("→");
  const optionName = lastArrow < 0 ? "" : latest.message.slice(lastArrow + 1).trim();
  return optionName ? `매운맛 변경: ${optionName}` : null;
}
