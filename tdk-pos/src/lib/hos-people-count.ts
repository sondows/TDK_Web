export type HosPeopleCount = { personCount: number; babyCount: number };

export function resolveHosPeopleCount(input: {
  personCount: number | null | undefined;
  babyCount: number | null | undefined;
  stewOrderCount: number;
  savedOverride?: HosPeopleCount | null;
}): HosPeopleCount {
  const personCount = input.personCount ?? 0;
  const babyCount = input.babyCount ?? 0;
  const savedOverride = input.savedOverride;

  if (savedOverride && savedOverride.personCount === personCount && savedOverride.babyCount === babyCount) {
    return savedOverride;
  }

  // Existing POS/QR behavior treats 0/0 as not yet registered.
  if (personCount > 0 || babyCount > 0) return { personCount, babyCount };
  return { personCount: Math.max(0, input.stewOrderCount), babyCount: 0 };
}
