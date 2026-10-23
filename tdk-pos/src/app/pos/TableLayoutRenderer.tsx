"use client";

import { Fragment, type CSSProperties, type ReactNode, type Ref } from "react";
import TableLayoutCanvas from "./TableLayoutCanvas";
import { TABLE_LAYOUT_REFERENCE_CANVAS, posMainFixedTablePosition, type TableLayoutValues } from "@/lib/table-layout";

type TableLayoutItem = TableLayoutValues & { tableId: number };
type Props<T extends TableLayoutItem> = {
  tables: readonly T[];
  renderTable: (table: T, fixedPosition: ReturnType<typeof posMainFixedTablePosition>) => ReactNode;
  children?: ReactNode;
  canvasRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  sceneStyle?: CSSProperties;
  debugName?: string;
  showSceneBoundary?: boolean;
  sceneBoundaryClassName?: string;
};

/** Every table screen renders the saved layout on one canonical scene and applies one viewport scale. */
export default function TableLayoutRenderer<T extends TableLayoutItem>({ tables, renderTable, children, canvasRef, className, style, sceneStyle, debugName, showSceneBoundary = false, sceneBoundaryClassName = "border-slate-300" }: Props<T>) {
  return <TableLayoutCanvas ref={canvasRef} className={className} debugName={debugName} referenceSize={TABLE_LAYOUT_REFERENCE_CANVAS} style={style} sceneStyle={sceneStyle}>
    {showSceneBoundary && <span aria-hidden="true" className={`pointer-events-none absolute inset-0 z-0 rounded-2xl border border-dashed ${sceneBoundaryClassName}`} />}
    {tables.map(table => <Fragment key={table.tableId}>{renderTable(table, posMainFixedTablePosition(table))}</Fragment>)}
    {children}
  </TableLayoutCanvas>;
}
