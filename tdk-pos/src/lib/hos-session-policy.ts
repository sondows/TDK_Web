export const HOS_SESSION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

export function isHosSessionCurrentBusinessDate(sessionDate: string, currentBusinessDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) && sessionDate === currentBusinessDate;
}
