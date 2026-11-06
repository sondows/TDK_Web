export type HosSectionTable = {
  tableId: number;
  tableNo: string;
  positionX: number;
  positionY: number;
  layoutWidth: number;
  layoutHeight: number;
  isVisible: boolean;
};

export type HosSectionLayout = {
  dividerPositions: number[];
  verticalOffsets: Map<number, number>;
  canvasHeightPercent: number;
  extraHeightPercent: number;
  fallbackReason: null;
  originalGaps: null;
  currentGaps: null;
  renderedGaps: null;
};

export const HOS_DIVIDER_SETTING_KEY = "hos.table-layout-dividers";
export const HOS_DIVIDER_LIMIT = 20;

export function parseHosDividerPositions(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((position): position is number => typeof position === "number" && Number.isFinite(position) && position > 0 && position < 100)
      .slice(0, HOS_DIVIDER_LIMIT);
  } catch {
    return [];
  }
}

export function calculateHosSectionLayout(tables: HosSectionTable[], verticalScale: number, dividerPositions: number[] = []): HosSectionLayout {
  const visibleTables = tables.filter(table => table.isVisible);
  const validDividers = dividerPositions
    .filter(position => Number.isFinite(position) && position > 0 && position < 100)
    .slice(0, HOS_DIVIDER_LIMIT);
  const deepestTableBottom = visibleTables.length
    ? Math.max(...visibleTables.map(table => (table.positionY + table.layoutHeight / 2) * verticalScale))
    : 100;
  const canvasHeightPercent = Math.max(deepestTableBottom, ...validDividers, visibleTables.length ? 0 : 100);
  return {
    dividerPositions: validDividers,
    verticalOffsets: new Map(),
    canvasHeightPercent,
    extraHeightPercent: canvasHeightPercent - 100,
    fallbackReason: null,
    originalGaps: null,
    currentGaps: null,
    renderedGaps: null,
  };
}
