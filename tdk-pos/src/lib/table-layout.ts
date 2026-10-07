export type TableLayoutValues = {
  positionX: number;
  positionY: number;
  layoutWidth: number;
  layoutHeight: number;
  rotation: number;
};

// Use the existing 1280x800 POS table area as the fixed pixel reference.
// Saved position and size percentages are converted through this canvas so
// resizing the browser cannot scale them, while layout edits still apply.
export const POS_TABLE_REFERENCE_CANVAS = { width: 447, height: 401 } as const;
const POS_TABLE_GEOMETRY_SCALE = 1.19;
const TABLE_BODY_INSET = { horizontal: 0.86, vertical: 0.7 };
const TABLE_FRAME_SAFE_INSET = 1;
const LEGACY_LAYOUT_SIZE_LIMITS = { min: 5, max: 60 };
export const TABLE_BODY_SIZE_LIMITS = {
  minWidth: 60,
  maxWidth: 400,
  minHeight: 60,
  maxHeight: 300,
} as const;

type TableSizeAxis = "width" | "height";

const referenceBodySize = (axis: TableSizeAxis) => axis === "width"
  ? POS_TABLE_REFERENCE_CANVAS.width * POS_TABLE_GEOMETRY_SCALE * TABLE_BODY_INSET.horizontal
  : POS_TABLE_REFERENCE_CANVAS.height * POS_TABLE_GEOMETRY_SCALE * TABLE_BODY_INSET.vertical;

function axisLimits(axis: TableSizeAxis) {
  return axis === "width"
    ? { min: TABLE_BODY_SIZE_LIMITS.minWidth, max: TABLE_BODY_SIZE_LIMITS.maxWidth }
    : { min: TABLE_BODY_SIZE_LIMITS.minHeight, max: TABLE_BODY_SIZE_LIMITS.maxHeight };
}

export function tableBodySizePx(storedSize: number, axis: TableSizeAxis) {
  // Values up to 60 are legacy canvas percentages. New values are body pixels.
  return storedSize <= LEGACY_LAYOUT_SIZE_LIMITS.max
    ? storedSize / 100 * referenceBodySize(axis)
    : storedSize;
}

export function tableBodySizeFromPx(pixels: number, axis: TableSizeAxis) {
  const { min, max } = axisLimits(axis);
  const clamped = Math.min(max, Math.max(min, pixels));
  // Keep 60px distinct from legacy 60% while retaining the DECIMAL(5,2) column.
  return clamped === LEGACY_LAYOUT_SIZE_LIMITS.max ? 60.01 : clamped;
}

export function tableSizeAsCanvasPercent(storedSize: number, axis: TableSizeAxis) {
  return storedSize <= LEGACY_LAYOUT_SIZE_LIMITS.max
    ? storedSize
    : tableBodySizePx(storedSize, axis) / referenceBodySize(axis) * 100;
}

export function isValidStoredTableSize(storedSize: unknown, axis: TableSizeAxis) {
  const value = Number(storedSize);
  if (!Number.isFinite(value)) return false;
  if (value <= LEGACY_LAYOUT_SIZE_LIMITS.max) {
    return value >= LEGACY_LAYOUT_SIZE_LIMITS.min;
  }
  const { min, max } = axisLimits(axis);
  return value >= min && value <= max;
}

function normalizeStoredSize(value: unknown, fallback: number, axis: TableSizeAxis) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  if (next <= LEGACY_LAYOUT_SIZE_LIMITS.max) {
    return Math.min(LEGACY_LAYOUT_SIZE_LIMITS.max, Math.max(LEGACY_LAYOUT_SIZE_LIMITS.min, next));
  }
  const { min, max } = axisLimits(axis);
  return Math.min(max, Math.max(min, next));
}

export function posMainFixedTableBodySize(layout: TableLayoutValues) {
  let width = tableBodySizePx(layout.layoutWidth, "width");
  let height = tableBodySizePx(layout.layoutHeight, "height");
  if (layout.rotation === 90 || layout.rotation === 270) [width, height] = [height, width];
  return { width, height };
}

export function tableBodySizeForRotation(layout: TableLayoutValues) {
  return posMainFixedTableBodySize(layout);
}

export function layoutSizeFromDisplayedBodyPx(
  layout: TableLayoutValues,
  width: number,
  height: number,
) {
  const nextWidth = tableBodySizeFromPx(width, "width");
  const nextHeight = tableBodySizeFromPx(height, "height");
  return layout.rotation === 90 || layout.rotation === 270
    ? { layoutWidth: nextHeight, layoutHeight: nextWidth }
    : { layoutWidth: nextWidth, layoutHeight: nextHeight };
}

export function posMainFixedTableSize(layout: TableLayoutValues) {
  const width = tableBodySizePx(layout.layoutWidth, "width");
  const height = tableBodySizePx(layout.layoutHeight, "height");
  return {
    width: width / TABLE_BODY_INSET.horizontal,
    height: height / TABLE_BODY_INSET.vertical,
  };
}

export function tableLayoutFrameSize(layout: TableLayoutValues) {
  const size = posMainFixedTableSize(layout);
  return layout.rotation === 90 || layout.rotation === 270
    ? { width: size.height, height: size.width }
    : size;
}

export function tableBodySizeLimitsForCanvas(layout: TableLayoutValues, canvasWidth: number, canvasHeight: number) {
  const rotated = layout.rotation === 90 || layout.rotation === 270;
  const maxBaseWidth = Math.min(TABLE_BODY_SIZE_LIMITS.maxWidth, Math.max(0, (rotated ? canvasHeight : canvasWidth) - TABLE_FRAME_SAFE_INSET * 2) * TABLE_BODY_INSET.horizontal);
  const maxBaseHeight = Math.min(TABLE_BODY_SIZE_LIMITS.maxHeight, Math.max(0, (rotated ? canvasWidth : canvasHeight) - TABLE_FRAME_SAFE_INSET * 2) * TABLE_BODY_INSET.vertical);
  const maxWidth = Math.max(TABLE_BODY_SIZE_LIMITS.minWidth, rotated ? maxBaseHeight : maxBaseWidth);
  const maxHeight = Math.max(TABLE_BODY_SIZE_LIMITS.minHeight, rotated ? maxBaseWidth : maxBaseHeight);
  return {
    minWidth: TABLE_BODY_SIZE_LIMITS.minWidth,
    maxWidth,
    minHeight: TABLE_BODY_SIZE_LIMITS.minHeight,
    maxHeight,
  };
}

export function clampTableLayoutToCanvas<T extends TableLayoutValues>(layout: T, canvasWidth: number, canvasHeight: number): T {
  if (canvasWidth <= 0 || canvasHeight <= 0) return layout;
  const rotated = layout.rotation === 90 || layout.rotation === 270;
  const maxBaseWidth = Math.max(TABLE_BODY_SIZE_LIMITS.minWidth, Math.min(TABLE_BODY_SIZE_LIMITS.maxWidth, Math.max(0, (rotated ? canvasHeight : canvasWidth) - TABLE_FRAME_SAFE_INSET * 2) * TABLE_BODY_INSET.horizontal));
  const maxBaseHeight = Math.max(TABLE_BODY_SIZE_LIMITS.minHeight, Math.min(TABLE_BODY_SIZE_LIMITS.maxHeight, Math.max(0, (rotated ? canvasWidth : canvasHeight) - TABLE_FRAME_SAFE_INSET * 2) * TABLE_BODY_INSET.vertical));
  const baseWidth = tableBodySizePx(layout.layoutWidth, "width");
  const baseHeight = tableBodySizePx(layout.layoutHeight, "height");
  const layoutWidth = baseWidth > maxBaseWidth ? tableBodySizeFromPx(maxBaseWidth, "width") : layout.layoutWidth;
  const layoutHeight = baseHeight > maxBaseHeight ? tableBodySizeFromPx(maxBaseHeight, "height") : layout.layoutHeight;
  return clampTableLayoutPosition({ ...layout, layoutWidth, layoutHeight }, canvasWidth, canvasHeight) as T;
}

export function clampTableLayoutPosition<T extends TableLayoutValues>(layout: T, canvasWidth: number, canvasHeight: number): T {
  if (canvasWidth <= 0 || canvasHeight <= 0) return layout;
  const frame = tableLayoutFrameSize(layout);
  const horizontalInset = Math.min(TABLE_FRAME_SAFE_INSET, Math.max(0, (canvasWidth - frame.width) / 2));
  const verticalInset = Math.min(TABLE_FRAME_SAFE_INSET, Math.max(0, (canvasHeight - frame.height) / 2));
  const centerX = clamp(layout.positionX / 100 * canvasWidth, frame.width / 2 + horizontalInset, canvasWidth - frame.width / 2 - horizontalInset);
  const centerY = clamp(layout.positionY / 100 * canvasHeight, frame.height / 2 + verticalInset, canvasHeight - frame.height / 2 - verticalInset);
  return {
    ...layout,
    positionX: centerX / canvasWidth * 100,
    positionY: centerY / canvasHeight * 100,
  } as T;
}

export function posMainFixedTablePosition(layout: TableLayoutValues) {
  return {
    // Match LayoutEditor: x/y are normalized center coordinates in the parent canvas.
    left: layout.positionX,
    top: layout.positionY,
    ...posMainFixedTableSize(layout),
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function defaultTableLayout(index: number): TableLayoutValues {
  return {
    positionX: 18 + (index % 3) * 32,
    positionY: 18 + Math.floor(index / 3) * 30,
    layoutWidth: 24,
    layoutHeight: 14,
    rotation: 0,
  };
}

export function resolveTableLayout(
  layout: Partial<TableLayoutValues>,
  index: number,
): TableLayoutValues {
  const fallback = defaultTableLayout(index);
  return {
    positionX: clamp(Number.isFinite(layout.positionX) ? Number(layout.positionX) : fallback.positionX, 0, 100),
    positionY: clamp(Number.isFinite(layout.positionY) ? Number(layout.positionY) : fallback.positionY, 0, 100),
    layoutWidth: normalizeStoredSize(layout.layoutWidth, fallback.layoutWidth, "width"),
    layoutHeight: normalizeStoredSize(layout.layoutHeight, fallback.layoutHeight, "height"),
    rotation: [0, 90, 180, 270].includes(Number(layout.rotation)) ? Number(layout.rotation) : 0,
  };
}

export function tableLayoutStyle(layout: TableLayoutValues) {
  return {
    left: `${layout.positionX}%`,
    top: `${layout.positionY}%`,
    width: `${layout.layoutWidth}%`,
    height: `${layout.layoutHeight}%`,
    transform: `translate(-50%, -50%) rotate(${layout.rotation}deg)`,
  };
}
