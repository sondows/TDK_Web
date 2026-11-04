export type HosTableLayout = {
  positionX: number;
  positionY: number;
  layoutWidth: number;
  layoutHeight: number;
  isVisible: boolean;
};

export type HosTableLayoutRecord = HosTableLayout & { tableId: number; tableNo: string };

// Stored layout percentages keep their original 6-row vertical coordinate space.
// The visual canvas is now 8 rows tall; scaling old coordinates to 75% preserves
// every existing table's pixel position and size while making the lower quarter editable.
export const HOS_LAYOUT_VERTICAL_SCALE = 0.75;
export const HOS_LAYOUT_MAX_POSITION_Y = 100 / HOS_LAYOUT_VERTICAL_SCALE;

export const HOS_LAYOUT_LIMITS = {
  minX: 0,
  maxX: 100,
  minY: 0,
  maxY: HOS_LAYOUT_MAX_POSITION_Y,
  minWidth: 10,
  maxWidth: 95,
  minHeight: 2.5,
  maxHeight: 95,
} as const;

export function compareTableNumbers(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clampHosTableLayout(layout: HosTableLayout): HosTableLayout {
  const layoutWidth = clamp(layout.layoutWidth, HOS_LAYOUT_LIMITS.minWidth, HOS_LAYOUT_LIMITS.maxWidth);
  const layoutHeight = clamp(layout.layoutHeight, HOS_LAYOUT_LIMITS.minHeight, HOS_LAYOUT_LIMITS.maxHeight);
  return {
    // Coordinates are the table center in the HOS canvas. Keep them independent
    // from dimensions so resizing never moves this table or its neighbors.
    positionX: clamp(layout.positionX, HOS_LAYOUT_LIMITS.minX, HOS_LAYOUT_LIMITS.maxX),
    positionY: clamp(layout.positionY, HOS_LAYOUT_LIMITS.minY, HOS_LAYOUT_LIMITS.maxY),
    layoutWidth,
    layoutHeight,
    isVisible: Boolean(layout.isVisible),
  };
}

export function snapHosPositionToGrid(positionX: number, positionY: number, canvasWidth: number, canvasHeight: number, spacing: number, maxY = 100) {
  if (canvasWidth <= 0 || canvasHeight <= 0 || !Number.isFinite(spacing) || spacing <= 0) return { positionX, positionY };
  const snapAxis = (position: number, canvasSize: number, maxPosition = 100) => {
    const maxGridPosition = Math.floor(canvasSize * maxPosition / 100 / spacing) * spacing;
    const snappedPixels = clamp(Math.round(position / 100 * canvasSize / spacing) * spacing, 0, maxGridPosition);
    return snappedPixels / canvasSize * 100;
  };
  return { positionX: snapAxis(positionX, canvasWidth), positionY: snapAxis(positionY, canvasHeight, maxY) };
}

export function isValidHosTableLayout(layout: HosTableLayout) {
  const values = [layout.positionX, layout.positionY, layout.layoutWidth, layout.layoutHeight];
  return values.every(Number.isFinite) &&
    layout.layoutWidth >= HOS_LAYOUT_LIMITS.minWidth && layout.layoutWidth <= HOS_LAYOUT_LIMITS.maxWidth &&
    layout.layoutHeight >= HOS_LAYOUT_LIMITS.minHeight && layout.layoutHeight <= HOS_LAYOUT_LIMITS.maxHeight &&
    layout.positionX >= HOS_LAYOUT_LIMITS.minX && layout.positionX <= HOS_LAYOUT_LIMITS.maxX &&
    layout.positionY >= HOS_LAYOUT_LIMITS.minY && layout.positionY <= HOS_LAYOUT_LIMITS.maxY &&
    typeof layout.isVisible === "boolean";
}

export function hosLayoutsOverlap(left: HosTableLayout, right: HosTableLayout, gap = 0) {
  return Math.abs(left.positionX - right.positionX) < (left.layoutWidth + right.layoutWidth) / 2 + gap &&
    Math.abs(left.positionY - right.positionY) < (left.layoutHeight + right.layoutHeight) / 2 + gap;
}

export function hasHosLayoutOverlap(layouts: HosTableLayoutRecord[]) {
  for (let index = 0; index < layouts.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < layouts.length; otherIndex += 1) {
      if (hosLayoutsOverlap(layouts[index], layouts[otherIndex])) return true;
    }
  }
  return false;
}

export function defaultHosTableLayout(index: number, tableCount: number): HosTableLayout {
  const rowCount = Math.max(1, tableCount);
  const rowHeight = clamp(Math.min(12.5, 75 / rowCount), HOS_LAYOUT_LIMITS.minHeight, HOS_LAYOUT_LIMITS.maxHeight);
  return {
    positionX: 50,
    positionY: clamp(((index + 0.5) / rowCount) * 100, rowHeight / 2, 100 - rowHeight / 2),
    layoutWidth: 85,
    layoutHeight: rowHeight,
    isVisible: true,
  };
}

export function resolveHosTableLayouts<T extends { tableId: number; tableNo: string }>(
  tables: T[],
  stored: Map<number, HosTableLayout>,
): Array<T & HosTableLayout> {
  const sorted = [...tables].sort((left, right) => compareTableNumbers(left.tableNo, right.tableNo) || left.tableId - right.tableId);
  const resolved = new Map<number, T & HosTableLayout>();
  for (const table of sorted) {
    const layout = stored.get(table.tableId);
    if (layout && isValidHosTableLayout(layout)) resolved.set(table.tableId, { ...table, ...layout });
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const table = sorted[index];
    if (resolved.has(table.tableId)) continue;
    const candidate = defaultHosTableLayout(index, sorted.length);
    resolved.set(table.tableId, { ...table, ...candidate });
  }
  return sorted.map(table => resolved.get(table.tableId)!);
}

export function parseHosTableLayout(value: string): HosTableLayout | null {
  try {
    const parsed = JSON.parse(value) as Partial<HosTableLayout>;
    const layout = {
      positionX: Number(parsed.positionX),
      positionY: Number(parsed.positionY),
      layoutWidth: Number(parsed.layoutWidth),
      layoutHeight: Number(parsed.layoutHeight),
      isVisible: parsed.isVisible,
    };
    return isValidHosTableLayout(layout as HosTableLayout) ? layout as HosTableLayout : null;
  } catch {
    return null;
  }
}
