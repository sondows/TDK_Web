export const MENU_CATEGORY_TAB_PALETTE = [
  { name: "빨강", hex: "#C62828" },
  { name: "주황", hex: "#EF6C00" },
  { name: "노랑", hex: "#D4A017" },
  { name: "연두·올리브", hex: "#7CB342" },
  { name: "초록", hex: "#1E8E3E" },
  { name: "청록", hex: "#00897B" },
  { name: "하늘·청색", hex: "#1E88E5" },
  { name: "파랑", hex: "#2563EB" },
  { name: "보라", hex: "#6D28D9" },
  { name: "분홍·자주", hex: "#C2185B" },
  { name: "회색", hex: "#9AA0A6" },
] as const;

type RGB = { r: number; g: number; b: number };

export function normalizeMenuCategoryTabColor(value: unknown): string | null {
  if (typeof value !== "string" || !/^#[\da-fA-F]{6}$/.test(value)) return null;
  return value.toUpperCase();
}

function parseHex(value: string): RGB {
  const safe = normalizeMenuCategoryTabColor(value) ?? "#E2E8F0";
  return { r: Number.parseInt(safe.slice(1, 3), 16), g: Number.parseInt(safe.slice(3, 5), 16), b: Number.parseInt(safe.slice(5, 7), 16) };
}

function toHex({ r, g, b }: RGB) {
  return `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function mix(color: RGB, target: RGB, amount: number): RGB {
  return {
    r: color.r + (target.r - color.r) * amount,
    g: color.g + (target.g - color.g) * amount,
    b: color.b + (target.b - color.b) * amount,
  };
}

function linearChannel(value: number) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(color: RGB) {
  return 0.2126 * linearChannel(color.r) + 0.7152 * linearChannel(color.g) + 0.0722 * linearChannel(color.b);
}

export function categoryTabContrastRatio(foregroundHex: string, backgroundHex: string) {
  const first = luminance(parseHex(foregroundHex));
  const second = luminance(parseHex(backgroundHex));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Keep the hue for inactive text while meeting WCAG AA against white. */
export function getMenuCategoryTabText(value: string, background = "#FFFFFF") {
  const color = parseHex(value);
  const backgroundColor = parseHex(background);
  for (let amount = 0; amount <= 1; amount += 0.04) {
    const candidate = toHex(mix(color, { r: 20, g: 28, b: 40 }, amount));
    if (categoryTabContrastRatio(candidate, toHex(backgroundColor)) >= 4.5) return candidate;
  }
  return "#111827";
}

function getActiveTabText(value: string) {
  const background = normalizeMenuCategoryTabColor(value) ?? "#E2E8F0";
  const whiteContrast = categoryTabContrastRatio("#FFFFFF", background);
  const darkContrast = categoryTabContrastRatio("#000000", background);
  return whiteContrast >= darkContrast ? "#FFFFFF" : "#000000";
}

export function getMenuCategoryTabStyles(value: unknown, active: boolean) {
  const color = normalizeMenuCategoryTabColor(value);
  if (!color) return active
    ? { backgroundColor: "#E2E8F0", color: "#334155" }
    : { backgroundColor: "transparent", color: "#64748B" };

  if (active) return { backgroundColor: color, color: getActiveTabText(color) };
  return { backgroundColor: "transparent", color: getMenuCategoryTabText(color, "#FFFFFF") };
}
