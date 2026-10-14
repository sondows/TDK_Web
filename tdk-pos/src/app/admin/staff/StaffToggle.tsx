"use client";

import type { ReactNode } from "react";
import styles from "../admin.module.css";

export default function StaffToggle({ label, checked, disabled = false, variant, onChange }: {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  variant?: "customer";
  onChange: (checked: boolean) => void;
}) {
  return <label className={`${styles.staffToggle}${variant === "customer" ? ` ${styles.staffToggleCustomer}` : ""}${disabled ? ` ${styles.staffToggleDisabled}` : ""}`}>
    <span>{label}</span>
    <span className={styles.staffToggleControl}>
      <input aria-checked={checked} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} role="switch" type="checkbox" />
      <span aria-hidden="true" className={styles.staffToggleTrack}>
        {variant === "customer" && <span className={styles.staffToggleValue}>{checked ? "ON" : "OFF"}</span>}
      </span>
      {variant !== "customer" && <span aria-hidden="true" className={styles.staffToggleValue}>{checked ? "ON" : "OFF"}</span>}
    </span>
  </label>;
}
