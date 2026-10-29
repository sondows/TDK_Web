/** UI-only employee identifier mask; never use this value for authentication or attribution. */
export function maskEmployeeLoginId(loginId: string | null | undefined) {
  const normalized = loginId?.trim() ?? "";
  return `${Array.from(normalized).slice(0, 3).join("")}****`;
}
