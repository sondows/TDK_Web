export type QrHeroTouchIntent = "tap" | "left" | "right" | "up" | "down";

export function getQrHeroTouchIntent(deltaX: number, deltaY: number): QrHeroTouchIntent | null {
  if (Math.abs(deltaX) > 36 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) return deltaX < 0 ? "left" : "right";
  if (Math.abs(deltaY) > 28 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2) return deltaY < 0 ? "up" : "down";
  if (Math.hypot(deltaX, deltaY) < 12) return "tap";
  return null;
}
