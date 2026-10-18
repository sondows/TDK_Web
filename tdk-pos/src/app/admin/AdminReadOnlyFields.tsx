"use client";

import type { ReactNode } from "react";
import { useAdminReadOnly } from "./AdminAccessContext";

export default function AdminReadOnlyFields({ children }: { children: ReactNode }) {
  const readOnly = useAdminReadOnly();
  return readOnly ? <fieldset className="contents" disabled>{children}</fieldset> : <>{children}</>;
}
