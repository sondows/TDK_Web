export const MANAGED_DEVICE_TYPES = ["POS", "ADM", "KDS", "HOS"] as const;

export type ManagedDeviceType = (typeof MANAGED_DEVICE_TYPES)[number];

export type ManagedDevicePermissions = {
  posEnabled: boolean;
  admEnabled: boolean;
  kdsEnabled: boolean;
  hosEnabled: boolean;
};

export function isManagedDeviceType(value: unknown): value is ManagedDeviceType {
  return typeof value === "string" && MANAGED_DEVICE_TYPES.some(type => type === value);
}

export function managedDeviceCode(type: ManagedDeviceType, deviceId: number) {
  return `${type}-${String(deviceId).padStart(3, "0")}`;
}
