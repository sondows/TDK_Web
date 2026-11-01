/** Reject common six-digit patterns while retaining leading zeroes as text. */
export function isAcceptableEmployeePin(pin: unknown): pin is string {
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return false;
  if (/^(\d)\1{5}$/.test(pin)) return false;
  if (pin.slice(0, 3) === pin.slice(3)) return false;
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return false;
  if (["123456", "654321", "111222", "000000", "121212", "112233"].includes(pin)) return false;
  return true;
}
