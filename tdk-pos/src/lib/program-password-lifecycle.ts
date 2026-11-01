import "server-only";

import { randomBytes } from "node:crypto";

/** Shown only once to the administrator; only its slow hash is persisted. */
export function newTemporaryProgramPassword() {
  return `T1!${randomBytes(24).toString("base64url")}`;
}
