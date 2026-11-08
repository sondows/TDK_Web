export type PosFanLayout = {
  fanId: number;
  name: string;
  entityId: string;
  positionX: number;
  positionY: number;
  isVisible: boolean;
  sortOrder: number;
};

export const POS_FAN_COUNT = 6;
export const POS_FAN_SETTING_PREFIX = "pos.fan-layout.";
export const POS_FAN_ENTITY_IDS = [
  "switch.sonoff_a4b0026ef4", "switch.sonoff_a4b0026ef9", "switch.sonoff_a4b0026ef3",
  "switch.sonoff_a4b0026ef8", "switch.sonoff_a4b0026ef5", "switch.sonoff_a4b0026ef7",
] as const;

export const DEFAULT_POS_FAN_LAYOUTS: PosFanLayout[] = [
  { fanId: 1, name: "선풍기1", entityId: "switch.sonoff_a4b0026ef4", positionX: 10, positionY: 90, isVisible: false, sortOrder: 1 },
  { fanId: 2, name: "선풍기2", entityId: "switch.sonoff_a4b0026ef9", positionX: 26, positionY: 90, isVisible: false, sortOrder: 2 },
  { fanId: 3, name: "선풍기3", entityId: "switch.sonoff_a4b0026ef3", positionX: 42, positionY: 90, isVisible: false, sortOrder: 3 },
  { fanId: 4, name: "선풍기4", entityId: "switch.sonoff_a4b0026ef8", positionX: 58, positionY: 90, isVisible: false, sortOrder: 4 },
  { fanId: 5, name: "선풍기5", entityId: "switch.sonoff_a4b0026ef5", positionX: 74, positionY: 90, isVisible: false, sortOrder: 5 },
  { fanId: 6, name: "선풍기6", entityId: "switch.sonoff_a4b0026ef7", positionX: 90, positionY: 90, isVisible: false, sortOrder: 6 },
];

export function isPosFanLayout(value: unknown): value is PosFanLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<PosFanLayout>;
  return Number.isInteger(layout.fanId) && Number(layout.fanId) >= 1 && Number(layout.fanId) <= POS_FAN_COUNT &&
    typeof layout.name === "string" && layout.name.trim().length > 0 && layout.name.length <= 32 &&
    typeof layout.entityId === "string" && POS_FAN_ENTITY_IDS.includes(layout.entityId as typeof POS_FAN_ENTITY_IDS[number]) &&
    Number.isFinite(layout.positionX) && Number(layout.positionX) >= 0 && Number(layout.positionX) <= 100 &&
    Number.isFinite(layout.positionY) && Number(layout.positionY) >= 0 && Number(layout.positionY) <= 100 &&
    typeof layout.isVisible === "boolean" && Number.isInteger(layout.sortOrder) &&
    Number(layout.sortOrder) >= 1 && Number(layout.sortOrder) <= POS_FAN_COUNT;
}

export function isValidPosFanLayouts(value: unknown): value is PosFanLayout[] {
  if (!Array.isArray(value) || value.length !== POS_FAN_COUNT || !value.every(isPosFanLayout)) return false;
  const fanIds = value.map(item => item.fanId);
  const entityIds = value.map(item => item.entityId);
  const sortOrders = value.map(item => item.sortOrder);
  return new Set(fanIds).size === POS_FAN_COUNT && new Set(entityIds).size === POS_FAN_COUNT &&
    new Set(sortOrders).size === POS_FAN_COUNT && fanIds.every(id => id >= 1 && id <= POS_FAN_COUNT);
}

export function parsePosFanLayout(value: string | null | undefined): PosFanLayout | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPosFanLayout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getPosFanSettingKey(fanId: number) {
  return `${POS_FAN_SETTING_PREFIX}${fanId}`;
}
