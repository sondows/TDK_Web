export type HosSessionRestoreDecision = "AUTHENTICATED" | "LOGIN_REQUIRED" | "RETRY";

export function decideHosSessionRestore(status: number, authenticated: boolean | undefined): HosSessionRestoreDecision {
  if (status === 401) return "LOGIN_REQUIRED";
  if (status === 200 && authenticated === true) return "AUTHENTICATED";
  return "RETRY";
}
