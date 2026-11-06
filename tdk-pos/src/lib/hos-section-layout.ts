export type HosSectionTable = {
  tableId: number;
  tableNo: string;
  positionX: number;
  positionY: number;
  layoutWidth: number;
  layoutHeight: number;
  isVisible: boolean;
};

export type SectionGaps = { first: number; second: number };

export type HosSectionLayout = {
  dividerPositions: number[];
  verticalOffsets: Map<number, number>;
  canvasHeightPercent: number;
  extraHeightPercent: number;
  fallbackReason: string | null;
  originalGaps: SectionGaps | null;
  currentGaps: SectionGaps | null;
  renderedGaps: SectionGaps | null;
};

function getExistingSectionDividerPositions(tables: HosSectionTable[], verticalScale: number) {
  const visibleTables = tables.filter(table => table.isVisible);
  const boundsOf = (table: HosSectionTable) => ({
    top: (table.positionY - table.layoutHeight / 2) * verticalScale,
    bottom: (table.positionY + table.layoutHeight / 2) * verticalScale,
  });
  const group = (start: number, end: number) => visibleTables.filter(table => {
    const number = Number(table.tableNo);
    return Number.isInteger(number) && number >= start && number <= end;
  });
  const positions: number[] = [];
  const lineEdgeClearance = 1;
  const minimumGroupGap = Math.max(lineEdgeClearance, 0.6);
  const isClear = (position: number) => visibleTables.every(table => {
    const bounds = boundsOf(table);
    return position <= bounds.top - lineEdgeClearance / 2 || position >= bounds.bottom + lineEdgeClearance / 2;
  });

  for (const [previousRange, nextRange] of [[[1, 4], [5, 8]], [[5, 8], [9, 12]]] as const) {
    const previous = group(previousRange[0], previousRange[1]);
    const next = group(nextRange[0], nextRange[1]);
    if (!previous.length || !next.length) continue;
    const previousBottom = Math.max(...previous.map(table => boundsOf(table).bottom));
    const nextTop = Math.min(...next.map(table => boundsOf(table).top));
    if (nextTop - previousBottom < minimumGroupGap) continue;
    const position = (previousBottom + nextTop) / 2;
    if (isClear(position)) positions.push(position);
  }

  const finalGroup = group(9, 12);
  if (finalGroup.length) {
    const finalBottom = Math.max(...finalGroup.map(table => boundsOf(table).bottom));
    const position = finalBottom + 2.5;
    if (position < 100 && isClear(position)) positions.push(position);
  }
  return positions;
}

export function calculateHosSectionLayout(tables: HosSectionTable[], verticalScale: number): HosSectionLayout {
  const visibleTables = tables.filter(table => table.isVisible);
  const boundsOf = (table: HosSectionTable, offset = 0) => ({
    top: (table.positionY - table.layoutHeight / 2) * verticalScale + offset,
    bottom: (table.positionY + table.layoutHeight / 2) * verticalScale + offset,
    left: table.positionX - table.layoutWidth / 2,
    right: table.positionX + table.layoutWidth / 2,
  });
  const group = (start: number, end: number) => visibleTables.filter(table => {
    const number = Number(table.tableNo);
    return Number.isInteger(number) && number >= start && number <= end;
  });
  const firstGroup = group(1, 4);
  const secondGroup = group(5, 8);
  const thirdGroup = group(9, 12);
  const fallback = (reason: string): HosSectionLayout => {
    const dividerPositions = getExistingSectionDividerPositions(tables, verticalScale);
    const deepestTableBottom = visibleTables.length
      ? Math.max(...visibleTables.map(table => boundsOf(table).bottom))
      : 100;
    const canvasHeightPercent = Math.max(deepestTableBottom, ...dividerPositions, visibleTables.length ? 0 : 100);
    return {
      dividerPositions,
      verticalOffsets: new Map<number, number>(),
      canvasHeightPercent,
      extraHeightPercent: canvasHeightPercent - 100,
      fallbackReason: reason,
      originalGaps: null,
      currentGaps: null,
      renderedGaps: null,
    };
  };

  if (!firstGroup.length || !secondGroup.length || !thirdGroup.length) return fallback("missing-table-group");

  const groupBottom = (items: HosSectionTable[], offset = 0) => Math.max(...items.map(table => boundsOf(table, offset).bottom));
  const groupTop = (items: HosSectionTable[], offset = 0) => Math.min(...items.map(table => boundsOf(table, offset).top));
  const originalGap1 = groupTop(secondGroup) - groupBottom(firstGroup);
  const originalGap2 = groupTop(thirdGroup) - groupBottom(secondGroup);

  // The previous renderer doubled the visible baseline gap. Calculate that
  // actual rendered gap first, then target exactly half of it.
  const minimumBaselineGap = 5;
  const baselineOffset2 = Math.max(0, minimumBaselineGap - originalGap1);
  const baselineGap1 = originalGap1 + baselineOffset2;
  const baselineOffset3 = Math.max(0, baselineOffset2 + minimumBaselineGap - originalGap2);
  const baselineGap2 = originalGap2 + baselineOffset3 - baselineOffset2;

  const currentOffset2 = Math.max(0, 2 * baselineGap1 - originalGap1);
  const currentOffset3 = Math.max(currentOffset2, currentOffset2 + 2 * baselineGap2 - originalGap2);
  const currentGap1 = originalGap1 + currentOffset2;
  const currentGap2 = originalGap2 + currentOffset3 - currentOffset2;

  const targetGap1 = currentGap1 / 2;
  const targetGap2 = currentGap2 / 2;
  const targetOffset2 = targetGap1 - originalGap1;
  const targetOffset3 = targetOffset2 + targetGap2 - originalGap2;
  const divider1 = (groupBottom(firstGroup) + groupTop(secondGroup, targetOffset2)) / 2;
  const divider2 = (groupBottom(secondGroup, targetOffset2) + groupTop(thirdGroup, targetOffset3)) / 2;
  const divider3 = groupBottom(thirdGroup, targetOffset3) + 2.5;
  const verticalOffsets = new Map<number, number>();
  for (const table of secondGroup) verticalOffsets.set(table.tableId, targetOffset2);
  for (const table of thirdGroup) verticalOffsets.set(table.tableId, targetOffset3);

  const hasNewOverlap = visibleTables.some((table, index) => visibleTables.slice(index + 1).some(other => {
    const beforeA = boundsOf(table);
    const beforeB = boundsOf(other);
    const afterA = boundsOf(table, verticalOffsets.get(table.tableId) ?? 0);
    const afterB = boundsOf(other, verticalOffsets.get(other.tableId) ?? 0);
    const intersects = (a: typeof beforeA, b: typeof beforeB) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return intersects(afterA, afterB) && !intersects(beforeA, beforeB);
  }));
  const outsideCanvas = visibleTables.some(table => boundsOf(table, verticalOffsets.get(table.tableId) ?? 0).top < 0);
  const lineCrossesTable = (position: number) => visibleTables.some(table => {
    const bounds = boundsOf(table, verticalOffsets.get(table.tableId) ?? 0);
    return position > bounds.top - 0.5 && position < bounds.bottom + 0.5;
  });

  if (hasNewOverlap || outsideCanvas || [divider1, divider2, divider3].some(lineCrossesTable)) {
    const reason = hasNewOverlap ? "new-overlap" : outsideCanvas ? "negative-top" : "divider-crosses-table";
    return fallback(reason);
  }

  const deepestTableBottom = Math.max(...visibleTables.map(table => boundsOf(table, verticalOffsets.get(table.tableId) ?? 0).bottom));
  const deepestContentPoint = Math.max(deepestTableBottom, divider3);
  const canvasHeightPercent = Math.max(0, deepestContentPoint);
  return {
    dividerPositions: [divider1, divider2, divider3],
    verticalOffsets,
    canvasHeightPercent,
    extraHeightPercent: canvasHeightPercent - 100,
    fallbackReason: null,
    originalGaps: { first: originalGap1, second: originalGap2 },
    currentGaps: { first: currentGap1, second: currentGap2 },
    renderedGaps: {
      first: groupTop(secondGroup, targetOffset2) - groupBottom(firstGroup),
      second: groupTop(thirdGroup, targetOffset3) - groupBottom(secondGroup, targetOffset2),
    },
  };
}
