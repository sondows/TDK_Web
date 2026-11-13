/** Format an absolute POS timestamp in the store's local timezone. */
export function formatPosTime(value: string | Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value instanceof Date ? value : new Date(value));
}

/** Return the POS business calendar day as naive bounds in Asia/Seoul. */
export function getPosDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const nextDate = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  return { date, start: `${date} 00:00:00`, end: `${nextDate} 00:00:00` };
}
