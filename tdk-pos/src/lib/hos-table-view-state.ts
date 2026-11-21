export function shouldShowHosEmptyTableState(tableCount: number, refreshing: boolean, error: string) {
  return tableCount === 0 && !refreshing && error.length === 0;
}
