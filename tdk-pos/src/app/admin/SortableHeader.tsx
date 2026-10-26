"use client";

import type { ReactNode } from "react";
import type { GridSortDirection } from "@/lib/admin-grid-sort";

export default function SortableHeader({
  active,
  children,
  className,
  direction,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
  direction: GridSortDirection;
  onClick: () => void;
}) {
  return <th aria-sort={active ? direction === "desc" ? "descending" : "ascending" : "none"} className={className} style={{ paddingBottom: 0, paddingTop: 0 }}>
    <button
      onClick={onClick}
      style={{
        alignItems: "center",
        background: "none",
        border: 0,
        boxSizing: "border-box",
        color: "inherit",
        cursor: "pointer",
        display: "inline-flex",
        font: "inherit",
        gap: "0.3em",
        justifyContent: "inherit",
        maxWidth: "100%",
        minHeight: "44px",
        minWidth: 0,
        padding: 0,
        textAlign: "inherit",
        touchAction: "manipulation",
        whiteSpace: "nowrap",
        width: "100%",
      }}
      type="button"
    >
      <span>{children}</span>{active && <span aria-hidden="true">{direction === "desc" ? "↑" : "↓"}</span>}
    </button>
  </th>;
}
