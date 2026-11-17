const SEOUL_TIME_ZONE = "Asia/Seoul";

export function qrIssueDateInSeoul(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatQrManagementNumber(issueDate: string, serial: number): string {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueDate);
  const [year, month, day] = dateParts?.slice(1).map(Number) ?? [];
  const dateIsValid = dateParts !== null
    && year >= 1 && year <= 9999
    && month >= 1 && month <= 12
    && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!dateIsValid
    || !Number.isSafeInteger(serial)
    || serial < 1
    || serial > 4_294_967_295) {
    throw new RangeError("QR management number is out of range");
  }
  const datePart = issueDate.replaceAll("-", "");
  const serialPart = String(serial).padStart(4, "0");
  return `${datePart}-${serialPart}`;
}
