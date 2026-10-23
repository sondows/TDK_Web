"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { TABLE_LAYOUT_REFERENCE_CANVAS, tableSceneScaleToFit } from "@/lib/table-layout";

const TableLayoutCanvas = forwardRef<HTMLDivElement, { children: ReactNode; className?: string; style?: CSSProperties; sceneStyle?: CSSProperties; debugName?: string; referenceSize?: { width: number; height: number } }>(function TableLayoutCanvas({ children, className = "", style, sceneStyle, debugName, referenceSize = TABLE_LAYOUT_REFERENCE_CANVAS }, canvasRef) {
  const canvas = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useImperativeHandle(canvasRef, () => canvas.current as HTMLDivElement);

  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const nextScale = tableSceneScaleToFit(width, height, referenceSize.width, referenceSize.height);
      setScale(current => current === nextScale ? current : nextScale);
    });
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [referenceSize.height, referenceSize.width]);

  const activeScale = scale ?? 1;
  const sceneSize = referenceSize;
  const scaledFrameStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: (sceneSize?.width ?? 0) * activeScale,
    height: (sceneSize?.height ?? 0) * activeScale,
    transform: "translate(-50%, -50%)",
    visibility: scale === null ? "hidden" : "visible",
  };
  const scaledSceneStyle: CSSProperties = {
    ...sceneStyle,
    position: "absolute",
    left: 0,
    top: 0,
    width: sceneSize?.width ?? 0,
    height: sceneSize?.height ?? 0,
    transform: `scale(${activeScale})`,
    transformOrigin: "top left",
  };

  return <div className={`relative h-full min-h-0 w-full overflow-hidden ${className}`} data-pos-layout={debugName} data-pos-shell ref={canvas} style={style}>
    <div data-table-layout-frame style={scaledFrameStyle}><div data-table-layout-scene style={scaledSceneStyle}>{children}</div></div>
  </div>;
});

export default TableLayoutCanvas;
