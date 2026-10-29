import type { ReactNode } from "react";
import { getOwnerSecurityState } from "@/lib/admin-auth";
import OwnerSecurityPrompt from "./OwnerSecurityPrompt";

export default async function SecurityLayout({ children }: { children: ReactNode }) {
  const state = await getOwnerSecurityState();
  if (state !== "AUTHORIZED") return <OwnerSecurityPrompt state={state} />;
  return children;
}
