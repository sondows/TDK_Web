import { randomInt } from "node:crypto";

const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const prefixByKind = {
  SALE: "S",
  COUPON: "C",
  GIFT: "G",
  EVENT: "E",
} as const;

export type LookupCodeKind = keyof typeof prefixByKind;

export function createLookupCode(kind: LookupCodeKind): string {
  let token = "";
  for (let i = 0; i < 10; i++) token += alphabet[randomInt(alphabet.length)];
  return `${prefixByKind[kind]}-${token}`;
}

export const isSaleLookupCode = (value: string): boolean =>
  /^S-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(value);
