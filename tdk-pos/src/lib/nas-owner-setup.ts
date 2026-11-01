import "server-only";
import { isOwnerSetupModeEnabled } from "./owner-setup-mode.cjs";

/** Attestation is created by server.cjs only for explicitly enabled local setup modes. */
export function isNasOwnerSetupRequest(request: Request) {
  return isOwnerSetupModeEnabled(process.env) &&
    request.headers.get("x-tdk-nas-owner-setup") === "1";
}

export function isNasOwnerSetupWrite(request: Request) {
  if (!isNasOwnerSetupRequest(request)) return false;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}
