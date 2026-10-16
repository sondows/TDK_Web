let fallbackCounter = 0;
type RequestCrypto = Pick<Crypto, "randomUUID" | "getRandomValues">;

/** Creates a UUID-shaped idempotency key in secure and non-secure browser contexts. */
export function createRequestId(webCrypto: RequestCrypto | undefined = globalThis.crypto): string {
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    // Keep uniqueness anchored to time and a per-page counter if Web Crypto is unavailable.
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    let timestamp = Date.now();
    for (let index = 5; index >= 0; index--) {
      bytes[index] = timestamp & 0xff;
      timestamp = Math.floor(timestamp / 256);
    }
    fallbackCounter = (fallbackCounter + 1) & 0xffff;
    bytes[6] = (bytes[6] & 0xf0) | ((fallbackCounter >>> 8) & 0x0f);
    bytes[7] = fallbackCounter & 0xff;
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
