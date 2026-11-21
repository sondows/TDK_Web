export type PosWorkspaceView = "qrOrders" | "tables" | "takeout" | "waiting";

export const POS_IDLE_RESET_ACTIVITY_EVENTS = ["pointerdown", "touchstart", "keydown", "wheel", "scroll"] as const;

export function getPosIdleResetView(view: PosWorkspaceView): PosWorkspaceView {
  return view === "qrOrders" ? "tables" : view;
}
