type RecoveryStatus = { available?: boolean; loginId?: string; passwordConfigured?: boolean };

export function masterRecoveryActionLabel(passwordConfigured: boolean) {
  return passwordConfigured ? "마스터 비밀번호 재설정" : "마스터 비밀번호 등록";
}

export async function checkMasterRecoveryId(loginId: string, token: string,
  request: typeof fetch = fetch) {
  const normalizedId = loginId.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedId))
    return { confirmed: false, rateLimited: false, passwordConfigured: false };
  const response = await request("/api/program-trust/master-recovery/status", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ loginId: normalizedId, token }),
  });
  const result = await response.json() as RecoveryStatus;
  return { confirmed: response.ok && result.available === true &&
      result.loginId?.toLowerCase() === normalizedId,
    rateLimited: response.status === 429,
    passwordConfigured: result.passwordConfigured === true };
}
