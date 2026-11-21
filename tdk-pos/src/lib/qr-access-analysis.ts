export const QR_ACCESS_ACTIONS = ["QR_ACCESS_ISSUED", "QR_ACCESS_REUSED", "QR_ACCESS_FAILED"] as const;
export type QrAccessAction = typeof QR_ACCESS_ACTIONS[number];
export type QrAccessAnomaly = "OUTSIDE_BUSINESS_HOURS" | "REPEATED_ACCESS" | "REPEATED_FAILURE" | "RETIRED_QR_ACCESS";
export type QrAccessRecord = {
  auditLogId: number;
  actionType: string;
  occurredAt: Date | string;
  failureType?: string | null;
  outsideBusinessHours?: boolean;
};

export function failureTypeFromDescription(description: string | null | undefined) {
  return description?.match(/^reason=([A-Z_]+)$/)?.[1] ?? null;
}

export function analyzeQrAccessAnomalies(records: QrAccessRecord[]) {
  const sorted = records.filter(record => QR_ACCESS_ACTIONS.includes(record.actionType as QrAccessAction))
    .map(record => ({ ...record, timestamp: new Date(record.occurredAt).getTime() }))
    .filter(record => Number.isFinite(record.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp || a.auditLogId - b.auditLogId);
  const labels = new Map<number, Set<QrAccessAnomaly>>();
  const add = (record: QrAccessRecord, anomaly: QrAccessAnomaly) => {
    const current = labels.get(record.auditLogId) ?? new Set<QrAccessAnomaly>();
    current.add(anomaly);
    labels.set(record.auditLogId, current);
  };

  for (const record of sorted) {
    if (record.outsideBusinessHours) add(record, "OUTSIDE_BUSINESS_HOURS");
    if (record.actionType === "QR_ACCESS_FAILED" && record.failureType === "RETIRED_QR") add(record, "RETIRED_QR_ACCESS");
  }

  const flagWindows = (subset: typeof sorted, threshold: number, anomaly: QrAccessAnomaly) => {
    let left = 0;
    for (let right = 0; right < subset.length; right += 1) {
      while (subset[right].timestamp - subset[left].timestamp > 5 * 60_000) left += 1;
      if (right - left + 1 < threshold) continue;
      for (let index = left; index <= right; index += 1) add(subset[index], anomaly);
    }
  };

  flagWindows(sorted, 10, "REPEATED_ACCESS");
  flagWindows(sorted.filter(record => record.actionType === "QR_ACCESS_FAILED"), 5, "REPEATED_FAILURE");
  return new Map([...labels].map(([id, values]) => [id, [...values]]));
}

export function summarizeQrAccess(records: QrAccessRecord[], anomalies: Map<number, QrAccessAnomaly[]>) {
  const access = records.filter(record => QR_ACCESS_ACTIONS.includes(record.actionType as QrAccessAction));
  const count = (action: QrAccessAction) => access.filter(record => record.actionType === action).length;
  const allLabels = new Set(access.flatMap(record => anomalies.get(record.auditLogId) ?? []));
  return {
    firstUseAt: access.length ? access.reduce((first, record) => new Date(record.occurredAt).getTime() < new Date(first).getTime() ? record.occurredAt : first, access[0].occurredAt) : null,
    recentUseAt: access.length ? access.reduce((latest, record) => new Date(record.occurredAt).getTime() > new Date(latest).getTime() ? record.occurredAt : latest, access[0].occurredAt) : null,
    attemptCount: access.length,
    successCount: count("QR_ACCESS_ISSUED") + count("QR_ACCESS_REUSED"),
    failureCount: count("QR_ACCESS_FAILED"),
    anomalyCount: allLabels.size,
    anomalyLabels: [...allLabels],
    accessRecordAvailable: access.length > 0,
  };
}
