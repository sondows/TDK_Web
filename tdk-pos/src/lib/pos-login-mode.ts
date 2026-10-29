import "server-only";

export type PosLoginMode = "PERSONAL" | "SHARED";

/** Shared POS authentication is retired. A stale database setting must never re-enable it. */
export async function getConfiguredPosLoginMode(): Promise<PosLoginMode> {
  return "PERSONAL";
}

/** All POS APIs now require an individual employee session. */
export async function getPosLoginMode(): Promise<PosLoginMode> {
  return "PERSONAL";
}
