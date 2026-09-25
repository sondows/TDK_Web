export const PIN_LENGTH = 4;
export const PIN_PATTERN = /^\d{4}$/;

export function isValidPin(pin: string) {
  return PIN_PATTERN.test(pin);
}
