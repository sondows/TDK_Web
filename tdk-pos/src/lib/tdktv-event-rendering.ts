import type { CSSProperties } from "react";

export type TvEventVisual = {
  positionX: number;
  positionY: number;
  widthPercent: number;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  textAlign: "LEFT" | "CENTER" | "RIGHT";
  lineHeight: number;
  backgroundMode: "NONE" | "SOLID" | "TRANSLUCENT";
  backgroundColor: string;
  backgroundOpacity: number;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
};

function rgba(hex: string, opacity: number) {
  const value = /^#[\da-f]{6}$/i.test(hex) ? hex.slice(1) : "145B46";
  const parts = [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}

/** Outer positioning wrapper stays visually empty; only the text-sized child is painted. */
export function getTvEventAnchorStyle(event: TvEventVisual, interactive = false): CSSProperties {
  return {
    position: "absolute",
    zIndex: 2,
    left: `${event.positionX / 100}%`,
    top: `${event.positionY / 100}%`,
    width: "fit-content",
    maxWidth: `${Math.max(5, Math.min(100, event.widthPercent / 100))}%`,
    maxHeight: "90%",
    transform: "translate(-50%, -50%)",
    pointerEvents: interactive ? "auto" : "none",
    cursor: interactive ? "move" : undefined,
    touchAction: interactive ? "none" : undefined,
  };
}

export function getTvEventTextStyle(event: TvEventVisual): CSSProperties {
  return {
    display: "block",
    boxSizing: "border-box",
    width: "fit-content",
    maxWidth: "100%",
    maxHeight: "90vh",
    overflow: "hidden",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
    color: event.textColor,
    textAlign: event.textAlign.toLowerCase() as CSSProperties["textAlign"],
    fontFamily: '"Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
    fontSize: `clamp(16px, ${event.fontSize / 19.2}vw, ${event.fontSize}px)`,
    fontWeight: event.fontWeight,
    lineHeight: event.lineHeight / 100,
    border: event.borderEnabled ? `${event.borderWidth}px solid ${event.borderColor}` : "none",
    borderRadius: `${event.borderRadius}px`,
    backgroundColor: event.backgroundMode === "NONE" ? "transparent" : rgba(event.backgroundColor,
      event.backgroundMode === "SOLID" ? 100 : event.backgroundOpacity),
    padding: "0.14em 0.32em",
    textShadow: "0 2px 5px rgba(0, 0, 0, 0.78), 0 0 2px rgba(0, 0, 0, 0.8)",
  };
}
