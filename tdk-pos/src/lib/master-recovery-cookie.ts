/** Short-lived, path-scoped proof that a NAS-issued recovery link was opened. */
export const masterRecoveryCookieName = "tdk_adm_master_recovery";
export const masterRecoveryCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/program-trust/master-recovery",
  maxAge: 15 * 60,
};
