export const PIN_LENGTH = 4;
export const PIN_PATTERN = /^\d{4}$/;

export function isValidPin(pin: string) {
  return PIN_PATTERN.test(pin);
}

export const EMPLOYEE_PIN_LENGTH = 6;
export const EMPLOYEE_PIN_PATTERN = /^\d{6}$/;

export function isValidEmployeePin(pin: string) {
  return EMPLOYEE_PIN_PATTERN.test(pin);
}
