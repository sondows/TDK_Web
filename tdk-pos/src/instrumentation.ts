export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { scheduleQrCartAnalyticsRetention } = await import("@/lib/qr-cart-retention");
  const { scheduleKasiHolidayAutoSync } = await import("@/lib/kasi-holiday-service");
  scheduleQrCartAnalyticsRetention();
  scheduleKasiHolidayAutoSync();
}
