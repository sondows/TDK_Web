export type PosMenuRowPosition = { top: number; bottom: number; firstCategoryId: number | null };
export type PosCategoryDirection = "PREVIOUS" | "NEXT";
export type PosMenuCategoryRow<T> = { categoryId: number | null; menus: T[] };

function normalizedHex(value: unknown): string | null {
  return typeof value === "string" && /^#[\da-fA-F]{6}$/.test(value) ? value.toUpperCase() : null;
}

function mixHex(sourceHex: string, targetHex: string, targetWeight: number): string {
  const source = [1, 3, 5].map(index => Number.parseInt(sourceHex.slice(index, index + 2), 16));
  const target = [1, 3, 5].map(index => Number.parseInt(targetHex.slice(index, index + 2), 16));
  return `#${source.map((channel, index) => Math.round(channel * (1 - targetWeight) + target[index] * targetWeight).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** POS-only light pastel for menu cards: 12% ADM hue mixed with 88% white. */
export function getPosMenuCardBackground(tabColor: unknown, fallbackAccent: string): string {
  const color = normalizedHex(tabColor);
  return color ? mixHex(color, "#FFFFFF", 0.88) : `color-mix(in srgb, ${normalizedHex(fallbackAccent) ?? "#64748B"} 7%, white)`;
}

/** POS-only category corner marker, 18% darker while retaining the source hue. */
export function getPosCategoryCornerColor(tabColor: unknown, fallbackAccent: string): string {
  const color = normalizedHex(tabColor) ?? normalizedHex(fallbackAccent) ?? "#64748B";
  return mixHex(color, "#000000", 0.18);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

/** Pick the higher-contrast neutral text color for an active category background. */
export function getPosCategoryTextColor(background: unknown, fallbackAccent: string): string {
  const color = normalizedHex(background) ?? normalizedHex(fallbackAccent) ?? "#64748B";
  const luminance = relativeLuminance(color);
  const contrast = (foregroundLuminance: number) => (Math.max(luminance, foregroundLuminance) + 0.05) / (Math.min(luminance, foregroundLuminance) + 0.05);
  return contrast(relativeLuminance("#FFFFFF")) >= contrast(relativeLuminance("#000000")) ? "#FFFFFF" : "#000000";
}

/** Groups menus in ADM category order, then creates rows within each category only. */
export function groupPosMenusIntoCategoryRows<T extends { categoryId: number | null }>(
  menus: readonly T[],
  categoryIds: readonly number[],
): PosMenuCategoryRow<T>[] {
  const byCategory = new Map<number | null, T[]>();
  for (const menu of menus) {
    const group = byCategory.get(menu.categoryId) ?? [];
    group.push(menu);
    byCategory.set(menu.categoryId, group);
  }

  const orderedIds: Array<number | null> = [...new Set(categoryIds)];
  for (const menu of menus) {
    if (!orderedIds.includes(menu.categoryId)) orderedIds.push(menu.categoryId);
  }

  const rows: PosMenuCategoryRow<T>[] = [];
  for (const categoryId of orderedIds) {
    const categoryMenus = byCategory.get(categoryId) ?? [];
    for (let index = 0; index < categoryMenus.length; index += 3) {
      rows.push({ categoryId, menus: categoryMenus.slice(index, index + 3) });
    }
  }
  return rows;
}

export function getAdjacentPosCategoryId(categoryIds: readonly number[], currentId: number | null, direction: PosCategoryDirection): number | null {
  if (categoryIds.length === 0 || currentId === null) return null;
  const currentIndex = categoryIds.indexOf(currentId);
  if (currentIndex < 0) return null;
  const nextIndex = currentIndex + (direction === "PREVIOUS" ? -1 : 1);
  return nextIndex >= 0 && nextIndex < categoryIds.length ? categoryIds[nextIndex] : null;
}

/** Physical finger movement maps directly to the category on that side. */
export function getPosCategorySwipeDirection(startX: number, startY: number, endX: number, endY: number, threshold = 48): PosCategoryDirection | null {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return null;
  return deltaX < 0 ? "PREVIOUS" : "NEXT";
}

/** Horizontal wheel sign follows the requested previous/next direction. */
export function getPosCategoryWheelDirection(deltaX: number, deltaY: number): PosCategoryDirection | null {
  if (!Number.isFinite(deltaX) || Math.abs(deltaX) < Math.abs(deltaY) * 1.15) return null;
  return deltaX < 0 ? "PREVIOUS" : deltaX > 0 ? "NEXT" : null;
}

export function bindPosCategoryNavigation(
  list: HTMLElement,
  options: {
    getCategoryIds: () => readonly number[];
    getCurrentCategoryId: () => number | null;
    onSelect: (categoryId: number) => void;
  },
): () => void {
  let pointerStart: { id: number; x: number; y: number } | null = null;
  let suppressClick = false;
  let clickResetTimer = 0;
  let wheelX = 0;
  let wheelGestureHandled = false;
  let wheelIdleTimer = 0;

  const selectAdjacent = (direction: PosCategoryDirection) => {
    const nextId = getAdjacentPosCategoryId(options.getCategoryIds(), options.getCurrentCategoryId(), direction);
    if (nextId !== null) options.onSelect(nextId);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || (event.target as Element | null)?.closest(".pos-menu-cart-button,[data-pos-category-swipe-ignore]")) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = pointerStart;
    pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const direction = getPosCategorySwipeDirection(start.x, start.y, event.clientX, event.clientY);
    if (!direction) return;
    suppressClick = true;
    window.clearTimeout(clickResetTimer);
    clickResetTimer = window.setTimeout(() => { suppressClick = false; }, 350);
    selectAdjacent(direction);
  };
  const onPointerCancel = () => { pointerStart = null; };
  const onClickCapture = (event: MouseEvent) => {
    if (!suppressClick || (event.target as Element | null)?.closest(".pos-menu-cart-button")) return;
    suppressClick = false;
    window.clearTimeout(clickResetTimer);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  const onWheel = (event: WheelEvent) => {
    const deltaX = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    const deltaY = event.shiftKey ? 0 : event.deltaY;
    const direction = getPosCategoryWheelDirection(deltaX, deltaY);
    if (!direction) return;
    if (event.cancelable) event.preventDefault();
    wheelX += deltaX;
    window.clearTimeout(wheelIdleTimer);
    wheelIdleTimer = window.setTimeout(() => {
      wheelX = 0;
      wheelGestureHandled = false;
    }, 350);
    if (wheelGestureHandled || Math.abs(wheelX) < 40) return;
    wheelGestureHandled = true;
    selectAdjacent(wheelX < 0 ? "PREVIOUS" : "NEXT");
  };

  list.addEventListener("pointerdown", onPointerDown, { passive: true });
  list.addEventListener("pointerup", onPointerUp, { passive: true });
  list.addEventListener("pointercancel", onPointerCancel, { passive: true });
  list.addEventListener("click", onClickCapture, true);
  list.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    list.removeEventListener("pointerdown", onPointerDown);
    list.removeEventListener("pointerup", onPointerUp);
    list.removeEventListener("pointercancel", onPointerCancel);
    list.removeEventListener("click", onClickCapture, true);
    list.removeEventListener("wheel", onWheel);
    window.clearTimeout(clickResetTimer);
    window.clearTimeout(wheelIdleTimer);
  };
}

/** Returns the category on the leftmost menu of the row crossing the top-focus line. */
export function getPosTopRowCategoryId(rows: readonly PosMenuRowPosition[], focusLine: number): number | null {
  if (rows.length === 0 || !Number.isFinite(focusLine)) return null;
  const row = rows.find(item => item.top <= focusLine && item.bottom > focusLine)
    ?? rows.find(item => item.top > focusLine)
    ?? rows[rows.length - 1];
  return row.firstCategoryId;
}

/** Minimum inner bottom padding that lets every category start reach the scrollport top. */
export function getPosMenuCategoryBottomPadding(categoryStartTops: readonly number[], scrollHeight: number, clientHeight: number): number {
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight) || clientHeight <= 0) return 0;
  const currentMaxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const required = categoryStartTops.reduce((largest, top) => Number.isFinite(top)
    ? Math.max(largest, top - currentMaxScrollTop) : largest, 0);
  return Math.max(0, Math.ceil(required));
}
