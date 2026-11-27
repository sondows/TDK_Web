export function formatTvQrAuthCode(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 99) throw new RangeError("TV QR auth code must be between 0 and 99");
  return String(value).padStart(2, "0");
}

export function isTvAuthCodeTestIssueAllowed(nodeEnv: string | undefined, databaseName: string | undefined) {
  return nodeEnv === "development" && databaseName === "TDK_POS_TEST";
}

export function shouldDisplayTvQrAuthCode(screenCode: string, noticeActive: boolean) {
  return screenCode.toUpperCase() === "DP1" && !noticeActive;
}

function compareVersion(left: string, right: string) {
  const a = left.replace(/^0+(?=\d)/, "");
  const b = right.replace(/^0+(?=\d)/, "");
  return a.length === b.length ? a.localeCompare(b) : a.length - b.length;
}

export function isStaleTvQrAuthCodeResponse(
  candidate: { stateVersion: string; serverNowMs: number },
  latest: { stateVersion: string; serverNowMs: number },
) {
  if (!/^\d+$/.test(candidate.stateVersion)) return true;
  const versionOrder = compareVersion(candidate.stateVersion, latest.stateVersion);
  return versionOrder < 0 || (versionOrder === 0 && candidate.serverNowMs < latest.serverNowMs);
}
