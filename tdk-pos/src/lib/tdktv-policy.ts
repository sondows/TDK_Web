export const TV_ALLOWED_DURATIONS = [5, 10, 15, 20, 30] as const;
export const TV_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
export const TV_MAX_PIXELS = 40_000_000;
const storedNamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isSafeTvStoredName(value: string) { return storedNamePattern.test(value); }
export function isAllowedTvUploadName(value: string) { return /\.(jpe?g|png|webp)$/i.test(value); }
export function isValidTvDuration(value: unknown) { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3600; }
export function isValidTvSyncGroup(value: unknown) { return value === null || typeof value === "string" && /^[\p{L}\p{N} _-]{1,40}$/u.test(value); }
