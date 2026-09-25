"use client";

import { forwardRef, type CSSProperties, type ReactNode } from "react";

const TableLayoutCanvas = forwardRef<HTMLDivElement, { children: ReactNode; className?: string; style?: CSSProperties; debugName?: string }>(function TableLayoutCanvas({ children, className = "", style, debugName }, canvasRef) {
  return <div className={`relative h-full min-h-0 w-full overflow-hidden ${className}`} data-pos-layout={debugName} ref={canvasRef} style={style}>{children}</div>;
});

export default TableLayoutCanvas;
