"use client";

import styles from "../admin.module.css";

export default function StaffToggle({ label, checked, disabled = false, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <label className={`${styles.staffToggle}${disabled ? ` ${styles.staffToggleDisabled}` : ""}`}>
    <span>{label}</span>
    <span className={styles.staffToggleControl}>
      <input aria-checked={checked} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} role="switch" type="checkbox" />
      <span aria-hidden="true" className={styles.staffToggleTrack} />
      <span aria-hidden="true" className={styles.staffToggleValue}>{checked ? "ON" : "OFF"}</span>
    </span>
  </label>;
}
