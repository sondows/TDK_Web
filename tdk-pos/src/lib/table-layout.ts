export type TableLayoutValues = {
  positionX: number;
  positionY: number;
  layoutWidth: number;
  layoutHeight: number;
  rotation: number;
};

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
    layoutWidth: clamp(Number.isFinite(layout.layoutWidth) ? Number(layout.layoutWidth) : fallback.layoutWidth, 5, 60),
    layoutHeight: clamp(Number.isFinite(layout.layoutHeight) ? Number(layout.layoutHeight) : fallback.layoutHeight, 5, 60),
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
