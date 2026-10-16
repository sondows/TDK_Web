const SEOUL_TIME_ZONE = "Asia/Seoul";

function partsInSeoul(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>;
}

function wallTimeFromUtcCalendar(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`;
}

export function seoulClock(value: Date) {
  const parts = partsInSeoul(value);
  return `${parts.hour}:${parts.minute}`;
}

export function pickupAtAfterMinutes(orderTime: Date, minutes: number) {
  const parts = partsInSeoul(orderTime);
  const base = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return wallTimeFromUtcCalendar(new Date(base + minutes * 60_000));
}

export function pickupAtFromHHmm(orderTime: Date, input: string) {
  if (!/^\d{4}$/.test(input)) return null;
  const hour = Number(input.slice(0, 2));
  const minute = Number(input.slice(2));
  if (hour > 23 || minute > 59) return null;

  const parts = partsInSeoul(orderTime);
  let base = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, minute);
  const orderClockMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (hour * 60 + minute < orderClockMinutes) base += 24 * 60 * 60_000;
  return wallTimeFromUtcCalendar(new Date(base));
}

export function displayPickupTime(value: string | null | undefined) {
  if (!value) return "--:--";
  const match = /(?:T| )(\d{2}:\d{2})/.exec(value);
  return match?.[1] ?? "--:--";
}

export function formatTakeoutPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 15);
  if (digits.length === 4) return digits;
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return digits;
}

export function isValidPickupAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):00$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    && Number(hour) < 24
    && Number(minute) < 60;
}
