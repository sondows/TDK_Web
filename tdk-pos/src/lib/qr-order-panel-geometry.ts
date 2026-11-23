export type QrPanelSnapIndex = 0 | 1 | 2;
export type QrOrderPanelGeometry = { baseTop: number; offsets: [number, number, number] };

export function getQrOrderPanelGeometry({
  viewportHeight,
  heroHeight,
  titleHeight,
  bottomReserved = 72,
  minPanelHeight = 180,
}: {
  viewportHeight: number;
  heroHeight: number | null;
  titleHeight: number;
  bottomReserved?: number;
  minPanelHeight?: number;
}): QrOrderPanelGeometry {
  const topTarget = 6;
  if (heroHeight === null) {
    const bottomTop = Math.max(topTarget, Math.min(viewportHeight - bottomReserved - minPanelHeight, viewportHeight * 0.62));
    const middleTop = (topTarget + bottomTop) / 2;
    return { baseTop: middleTop, offsets: [topTarget - middleTop, 0, bottomTop - middleTop] };
  }

  const maxPanelTop = Math.max(topTarget, viewportHeight - bottomReserved);
  const bottomTop = Math.max(topTarget, Math.min(heroHeight, maxPanelTop));
  const middleTop = Math.max(topTarget, Math.min(heroHeight / 2 - titleHeight / 2, bottomTop - 48));
  return { baseTop: middleTop, offsets: [topTarget - middleTop, 0, bottomTop - middleTop] };
}

export function nextQrOrderPanelSnap(current: QrPanelSnapIndex, direction: "up" | "down" | "show-image"): QrPanelSnapIndex {
  if (direction === "show-image") return 2;
  return Math.max(0, Math.min(2, current + (direction === "up" ? -1 : 1))) as QrPanelSnapIndex;
}

export function qrPanelDocumentScrollTop(geometry: QrOrderPanelGeometry, index: QrPanelSnapIndex) {
  const bottomTop = geometry.baseTop + geometry.offsets[2];
  const panelTop = geometry.baseTop + geometry.offsets[index];
  return Math.max(0, bottomTop - panelTop);
}
