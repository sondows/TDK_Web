export function sessionElapsedMinutes(openedAt: string, now = Date.now()) {
  const openedAtMs = Date.parse(openedAt);
  if (!Number.isFinite(openedAtMs)) return 0;
  return Math.max(0, Math.floor((now - openedAtMs) / 60_000));
}

export function formatSessionElapsed(openedAt: string, now = Date.now()) {
  const minutes = sessionElapsedMinutes(openedAt, now);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
